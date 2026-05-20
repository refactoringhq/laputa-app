//! Open-note flow (ADR-0115 Phase 5d, refined Phase 5d-followup).
//!
//! Bridges `note_list_pane::OpenNoteEvent` → `note_item::NoteItem`
//! mounted in the workspace's center [`workspace::PaneGroup`].
//!
//! Lives in the binary crate (not in `workspace` or `note_item`) so the
//! type graph stays a forest: `note_item` already depends on
//! `workspace`, and the binary depends on both — adding the converse
//! edge would create a cycle.
//!
//! # Reuse, not rebuild
//!
//! The first `OpenNoteEvent` constructs a `NoteItem` with a live
//! `WKWebView`.  Every subsequent event *reuses* the same `NoteItem`
//! entity via [`NoteItem::open_in_webview`], which dispatches a fresh
//! [`editor_bridge::ToHost::NoteOpen`] over IPC.  This keeps the
//! WKWebView NSView (and its WebKit process) alive across note clicks,
//! eliminating the flicker that came from re-spawning the webview on
//! every selection in early Phase 5d.

#![cfg(target_os = "macos")]

use std::cell::RefCell;
use std::rc::Rc;

use anyhow::{Context as _, Result};
use gpui::{Context, Entity, Window};
use gpui_component::ActiveTheme as _;
use note_item::{NoteItem, ThemeMode};
use vault::{NoteId, Vault};
use workspace::TolariaWorkspace;

/// Read the active theme mode off the `gpui_component` Theme global.
/// Phase 7.9: every newly-mounted `NoteItem` immediately propagates
/// the current mode to its WebView so the editor body never
/// flash-renders the wrong palette before the theme observer fires
/// for the first time.
fn current_theme_mode(cx: &gpui::App) -> ThemeMode {
    if cx.theme().is_dark() {
        ThemeMode::Dark
    } else {
        ThemeMode::Light
    }
}

/// Slot holding the currently mounted [`NoteItem`].  Threaded through
/// the `subscribe_in` closure in `main.rs` so successive
/// `OpenNoteEvent`s reuse the same entity instead of constructing a
/// fresh one (and therefore a fresh `WKWebView`).
pub type ActiveNoteItemSlot = Rc<RefCell<Option<Entity<NoteItem>>>>;

/// Open a note in the workspace's active center [`workspace::Pane`].
///
/// On first call: reads the body via [`Vault::note_content`], constructs
/// a [`NoteItem`] with a live `WKWebView`, pushes it onto the active
/// pane via [`TolariaWorkspace::add_item_to_active_pane`], and stores
/// the entity in `slot` for reuse.
///
/// On subsequent calls: looks up the entity from `slot` and calls
/// [`NoteItem::open_in_webview`], which swaps the editor's note via
/// IPC without touching the underlying WebKit view.
///
/// # Errors
///
/// - `Vault` global is not installed (no `--vault <path>` at startup).
/// - The note id is unknown to the vault.
/// - `NoteItem::new_with_webview` fails (window-handle race or wry
///   build failure) on the first open.
/// - `NoteItem::open_in_webview` fails on subsequent opens.
pub fn open_note(
    workspace: &TolariaWorkspace,
    id: NoteId,
    slot: &ActiveNoteItemSlot,
    window: &mut Window,
    cx: &mut Context<TolariaWorkspace>,
) -> Result<()> {
    let vault = cx
        .try_global::<Vault>()
        .context("Vault global is not installed; pass --vault <path> at startup")?;
    let executor = cx.foreground_executor().clone();
    let note = executor
        .block_on(vault.note(id))
        .with_context(|| format!("note {id:?} not found in vault"))?;
    let body = executor
        .block_on(vault.note_content(id))
        .with_context(|| format!("reading body for note {id:?}"))?;

    // Bind the cloned entity into a fresh local so the `Ref<'_, ...>`
    // returned by `slot.borrow()` drops before we re-enter the slot
    // (indirectly) via the entity update — otherwise a future code path
    // that calls `slot.borrow_mut()` from inside `open_in_webview` would
    // hit a `BorrowMutError`.  Convention: every slot access is one
    // statement.
    let existing = slot.borrow().as_ref().cloned();
    if let Some(existing) = existing {
        existing
            .update(cx, |item, cx| item.open_in_webview(note, body, cx))
            .context("NoteItem::open_in_webview failed")?;
        // Worklist 2.2 — startup leaves the center pane empty so the
        // workspace renders the "Select a note to start editing"
        // placeholder.  The first real click reuses the preloaded
        // `NoteItem` entity (kept warm by `preload_blank_webview`) and
        // promotes it into the active pane here.  Subsequent clicks
        // already have the entity mounted; the `item_count == 0`
        // guard prevents `add_item_to_active_pane` from stacking
        // duplicate copies of the same entity.
        if workspace.active_pane_item_count(cx) == 0 {
            workspace.add_item_to_active_pane(existing, cx);
        }
        return Ok(());
    }

    let note_item = NoteItem::new_with_webview(note, body, window, cx)
        .context("constructing NoteItem with embedded WKWebView")?;
    let initial_mode = current_theme_mode(cx);
    note_item
        .update(cx, |item, cx| item.set_theme(initial_mode, cx))
        .context("propagating initial theme to NoteItem WebView")?;
    *slot.borrow_mut() = Some(note_item.clone());

    // Call `add_item_to_active_pane` directly on `&TolariaWorkspace`
    // rather than re-entering via `workspace.update(cx, ...)`.  The
    // caller (the `subscribe_in` closure in `main.rs`) is already
    // executing inside the workspace entity's update context — wrapping
    // in another `.update()` panics with
    // "cannot update TolariaWorkspace while it is already being updated"
    // the moment a real click fires `OpenNoteEvent`.
    workspace.add_item_to_active_pane(note_item, cx);
    Ok(())
}

/// Eagerly construct an *empty* `NoteItem` (with its live WKWebView)
/// at workspace startup so the editor's NSView and the editor host
/// bundle inside it are paid for *before* the user clicks anything.
///
/// Without this, the very first click triggers WKWebView allocation +
/// HTML load, and the user sees the black-NSView flash while WebKit
/// boots — `wry::WebViewBuilder::with_background_color` is a no-op on
/// macOS in lb-wry 0.53.3 (only the iOS path applies it), so the only
/// way to suppress the flash is to move construction out of the click
/// path.
///
/// Worklist 2.2 — the preloaded entity is stored in `slot` but NOT
/// added to the center [`workspace::Pane`].  The pane therefore boots
/// empty, which makes its renderer walk the "Select a note to start
/// editing" placeholder branch (`workspace::pane::Pane::render`'s
/// empty-state arm).  The first real [`OpenNoteEvent`] reuses the
/// entity via `open_note` and promotes it into the active pane there.
///
/// Independent of the vault: a blank editor is useful even when no
/// vault is open (the user may pick one via a future menu action).
///
/// Unlike [`open_note`] this no longer needs a `&TolariaWorkspace`
/// handle: the preload path only constructs the entity and stashes it
/// in `slot`.  The promotion into the active pane is deferred to
/// `open_note` so the empty-state branch can render until the first
/// user click.
pub fn preload_blank_webview(
    slot: &ActiveNoteItemSlot,
    window: &mut Window,
    cx: &mut Context<TolariaWorkspace>,
) -> Result<()> {
    let blank = NoteItem::new_blank_with_webview(window, cx)
        .context("constructing blank NoteItem with embedded WKWebView")?;
    let initial_mode = current_theme_mode(cx);
    blank
        .update(cx, |item, cx| item.set_theme(initial_mode, cx))
        .context("propagating initial theme to blank NoteItem WebView")?;
    *slot.borrow_mut() = Some(blank);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use gpui::{AppContext as _, SharedString};
    use std::path::PathBuf;
    use vault::{Note, NoteKind};
    use workspace::TolariaWorkspace;

    fn fresh_note(id: u64, title: &str) -> Note {
        Note {
            id: NoteId::from_raw(id),
            title: SharedString::from(title.to_string()),
            path: PathBuf::from(format!("/v/n-{id}.md")),
            kind: NoteKind::Markdown,
            modified: Utc::now(),
            byte_size: 0,
            frontmatter: vault::Frontmatter::default(),
        }
    }

    /// Verify the workspace's `add_item_to_active_pane` populates the
    /// center pane.  Uses `NoteItem::new_for_tests` (no live WebView)
    /// so the test runs in a headless `TestAppContext`.
    #[gpui::test]
    fn add_item_creates_pane_and_activates_item(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);
        let window = cx.add_window(TolariaWorkspace::empty);
        let item = cx.update(|cx| cx.new(|_| NoteItem::new_for_tests(fresh_note(7, "Test Note"))));
        window
            .update(cx, |ws_view, _window, cx| {
                ws_view.add_item_to_active_pane(item, cx);
                assert_eq!(
                    ws_view.active_pane_item_count(cx),
                    1,
                    "active pane must hold the freshly added NoteItem"
                );
            })
            .unwrap();
    }

    /// Regression: opening two different notes must NOT append a second
    /// `NoteItem` to the pane — the second open must reuse the entity
    /// stored in the slot.  Locks the no-flicker contract behind the
    /// Phase 5d-followup fix.
    #[gpui::test]
    fn second_open_reuses_active_note_item(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);
        let window = cx.add_window(TolariaWorkspace::empty);
        let slot: ActiveNoteItemSlot = Rc::new(RefCell::new(None));

        let item_a = cx.update(|cx| cx.new(|_| NoteItem::new_for_tests(fresh_note(1, "A"))));
        window
            .update(cx, |ws_view, _window, cx| {
                ws_view.add_item_to_active_pane(item_a.clone(), cx);
            })
            .unwrap();
        *slot.borrow_mut() = Some(item_a.clone());

        // Simulate the binary-crate dispatch for the second click:
        // because `slot` already holds an entity, the open flow must
        // swap state on the SAME entity instead of constructing a new
        // one and pushing it onto the pane.
        let note_b = fresh_note(2, "B");
        cx.update(|cx| {
            let existing = slot.borrow().clone().expect("slot populated");
            existing
                .update(cx, |item, cx| {
                    item.open_in_webview(note_b.clone(), "body B".into(), cx)
                })
                .expect("open_in_webview swap");
        });

        window
            .update(cx, |ws_view, _window, cx| {
                assert_eq!(
                    ws_view.active_pane_item_count(cx),
                    1,
                    "second open must reuse the existing NoteItem, not append"
                );
            })
            .unwrap();
        cx.update(|cx| {
            let item = slot.borrow().clone().unwrap();
            assert_eq!(item.read(cx).id(), note_b.id);
        });
    }

    /// Worklist 2.2 — a freshly opened workspace must boot with an
    /// *empty* center pane so the renderer walks the
    /// "Select a note to start editing" placeholder branch.  The
    /// preloaded blank `NoteItem` lives in the slot for warm-start
    /// reuse, but does NOT auto-mount into the active pane.
    ///
    /// The test simulates the post-`preload_blank_webview` state by
    /// populating the slot with a headless `NoteItem` (no live
    /// WKWebView in `TestAppContext`) and asserting the workspace
    /// reports zero items in the active pane.
    #[gpui::test]
    fn workspace_boots_with_empty_center_pane(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);
        let window = cx.add_window(TolariaWorkspace::empty);
        let slot: ActiveNoteItemSlot = Rc::new(RefCell::new(None));

        // Simulate `preload_blank_webview`: construct the blank entity
        // and store it in the slot, but do NOT add to the pane.
        let blank = cx.update(|cx| cx.new(|_| NoteItem::new_for_tests(fresh_note(0, ""))));
        *slot.borrow_mut() = Some(blank);

        window
            .update(cx, |ws_view, _window, cx| {
                assert_eq!(
                    ws_view.active_pane_item_count(cx),
                    0,
                    "workspace must boot with an empty center pane — worklist 2.2",
                );
            })
            .unwrap();
        assert!(
            slot.borrow().is_some(),
            "preload_blank_webview must keep the blank entity warm in the slot",
        );
    }

    /// Worklist 2.2 — the first `OpenNoteEvent` must promote the
    /// preloaded entity from the slot into the active pane, replacing
    /// the empty-state placeholder with the editor surface.
    ///
    /// Simulates the binary-crate dispatch path: slot is pre-populated
    /// (as `preload_blank_webview` would), the pane starts empty, and
    /// the open flow takes the `existing` branch + the
    /// `item_count == 0` guard to push the entity onto the pane.
    #[gpui::test]
    fn first_open_promotes_slot_entity_into_active_pane(cx: &mut gpui::TestAppContext) {
        cx.update(gpui_component::init);
        let window = cx.add_window(TolariaWorkspace::empty);
        let slot: ActiveNoteItemSlot = Rc::new(RefCell::new(None));

        // Stand-in for `preload_blank_webview`: a headless `NoteItem`
        // entity lives in the slot from workspace startup.
        let preloaded = cx.update(|cx| cx.new(|_| NoteItem::new_for_tests(fresh_note(0, ""))));
        *slot.borrow_mut() = Some(preloaded.clone());

        // Pane starts empty (worklist 2.2 boot invariant).
        window
            .update(cx, |ws_view, _window, cx| {
                assert_eq!(ws_view.active_pane_item_count(cx), 0);
            })
            .unwrap();

        // First user click: drive the slot-reuse branch.  The real
        // `open_note` would also call `open_in_webview` for the IPC
        // swap; that path is exercised by the existing
        // `second_open_reuses_active_note_item` test.  Here we focus
        // on the *promotion* contract: empty pane → entity mounted.
        window
            .update(cx, |ws_view, _window, cx| {
                if ws_view.active_pane_item_count(cx) == 0 {
                    let existing = slot.borrow().clone().expect("slot populated");
                    ws_view.add_item_to_active_pane(existing, cx);
                }
                assert_eq!(
                    ws_view.active_pane_item_count(cx),
                    1,
                    "first open must promote the preloaded entity into the pane",
                );
            })
            .unwrap();
    }
}
