#![deny(unsafe_code)]
#![warn(missing_docs)]
//! Per-note WKWebView `Item` hosting the embedded editor (ADR-0115
//! Phase 4-MVP).
//!
//! A [`NoteItem`] owns:
//!
//! - the note's metadata (id, title, on-disk path) cloned from
//!   [`vault::Note`] at construction time;
//! - a dirty flag toggled by [`apply_from_host`][NoteItem::apply_from_host]
//!   in response to [`editor_bridge::FromHost::Dirty`] / `Save` / `Saved`;
//! - on macOS, an `Entity<gpui_wry::WebView>` that renders the
//!   `editor-host/dist/index.html` bundle inside a sibling NSView.
//!
//! The macOS `WebView` is constructed via [`NoteItem::new_with_webview`].
//! All other platforms construct via [`NoteItem::new_for_tests`], which
//! skips the WebView entirely so workspace CI builds stay clean.
//!
//! # IPC routing
//!
//! The wry IPC handler currently parses each incoming message into a
//! [`editor_bridge::FromHost`] and logs it.  Phase 5-MVP will wire the
//! parsed messages back into the GPUI entity (channel + foreground
//! task) so `Dirty` / `Save` mutate `self` and trigger vault writes —
//! the [`apply_from_host`][NoteItem::apply_from_host] pure-logic
//! handler already implements the state update, so Phase 5-MVP only
//! needs to bridge the thread boundary.
//!
//! # Bundled editor host
//!
//! `EDITOR_HOST_HTML` embeds `editor-host/dist/index.html` via
//! `include_str!` so Cargo builds do not require a JS toolchain.
//! Rebuild the dist with `pnpm --ignore-workspace build` from
//! `editor-host/` after editing the TypeScript sources.

use std::path::{Path, PathBuf};

use anyhow::{Context as _, Result};
pub use editor_bridge::ThemeMode;
use editor_bridge::{encode_to_host, FromHost, Mods, NoteOpen, ToHost};
use gpui::{
    div, App, Context, EventEmitter, IntoElement, ParentElement, Render, SharedString, Styled,
    Task, Window,
};
use gpui_component::v_flex;
use vault::{Note, NoteId};
use workspace::Item;

mod note_toolbar;
pub use note_toolbar::NOTE_TOOLBAR_HEIGHT_PT;

#[cfg(target_os = "macos")]
pub use macos::FRAME_EPSILON;
#[cfg(target_os = "macos")]
use macos::{spawn_webview, FrameSyncState, InstrumentedWebView};

/// Embedded editor host bundle.  Built by Vite at
/// `editor-host/dist/index.html`.  Loaded into every `NoteItem`'s
/// WKWebView via `wry::WebViewBuilder::with_html`.
pub const EDITOR_HOST_HTML: &str = include_str!("../../../editor-host/dist/index.html");

// ---------------------------------------------------------------------------
// Events (Phase 8.3)
// ---------------------------------------------------------------------------

/// Emitted by [`NoteItem`] when the embedded editor reports a click
/// on a `[[wikilink]]` or external `<a>` tag.  Workspace subscribers
/// (Phase 5d-followup + 8.13) route wikilinks through
/// [`vault::Vault::search_titles`] and external URLs through
/// `cx.open_url`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkClickEvent {
    /// Classified target as produced by [`LinkTarget::classify`].
    pub target: LinkTarget,
}

/// Emitted by [`NoteItem`] when the embedded editor relays a
/// shortcut-shaped keydown (any of Cmd/Ctrl/Alt held).  Workspace
/// subscribers route into the action registry so editor-side
/// shortcuts reach the native keymap (Phase 9.1 `command_registry`).
///
/// Pre-Phase 9.1 the workspace can use the `key`+`mods` pair to
/// dispatch a specific [`gpui::Action`] directly via
/// `cx.dispatch_action`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeydownEvent {
    /// Logical key name as reported by the editor (mirrors the DOM
    /// `KeyboardEvent.key` value, e.g. `"s"`, `"Enter"`, `"ArrowDown"`).
    pub key: SharedString,
    /// Modifier mask in effect when the key was pressed.
    pub mods: Mods,
}

/// Classified link target from [`Outcome::NavigateLink`].  Lets the
/// caller dispatch into `vault::search_titles` (for wikilinks) or
/// `cx.open_url` (for external URLs) without re-parsing the string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkTarget {
    /// In-vault wikilink (`MyNote`).
    Wikilink(String),
    /// External URL (`http://`, `https://`, etc.).
    Url(String),
}

impl LinkTarget {
    /// Classify a raw `editor_bridge::LinkClick.target` string.
    /// Anything with a scheme prefix is treated as a URL; everything
    /// else is a wikilink.
    #[must_use]
    pub fn classify(target: String) -> Self {
        let is_url = target.starts_with("http://")
            || target.starts_with("https://")
            || target.starts_with("mailto:");
        if is_url {
            Self::Url(target)
        } else {
            Self::Wikilink(target)
        }
    }
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

/// Outcome of [`NoteItem::apply_from_host`].  Lets the caller (the IPC
/// dispatch loop) know what side-effects to schedule — the pure-logic
/// handler itself never touches `vault` or the WebView.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// No external action needed; internal state (e.g. `dirty`) may
    /// have changed.
    None,
    /// Caller should call `vault.save(self.id(), &body)`.  The
    /// `NoteId` is intentionally absent — by construction
    /// `apply_from_host` only emits this when the incoming id
    /// matches `self.id`, so the caller already has the correct id
    /// via [`NoteItem::id`].
    PersistSave {
        /// Body that should land on disk.
        body: String,
    },
    /// Caller should resolve a wikilink target or open an external URL.
    NavigateLink(LinkTarget),
    /// Caller should dispatch the relayed shortcut into the native
    /// action registry.  Carries the canonical [`KeydownEvent`] shape
    /// so the dispatch loop can emit it without re-allocating, and
    /// keeps the public `Outcome` enum free of the `FromHost` transport
    /// type that the pure-logic handler has already parsed.
    DispatchKeydown(KeydownEvent),
    /// Editor just announced [`FromHost::Ready`] and a queued
    /// [`NoteOpen`] was waiting in `pending_open` — caller must inject
    /// it into the WebView.  Surfaces the drain as part of the
    /// pure-logic state machine instead of leaving the dispatch loop
    /// to poll for it on every message.
    DeliverPending(NoteOpen),
}

// ---------------------------------------------------------------------------
// NoteItem
// ---------------------------------------------------------------------------

/// `Item` implementation owning a per-note WKWebView.
pub struct NoteItem {
    id: NoteId,
    title: SharedString,
    path: PathBuf,
    dirty: bool,
    /// `true` once the editor host has emitted [`FromHost::Ready`].
    /// `open_in_webview` uses this to decide between sending the
    /// [`ToHost::NoteOpen`] immediately and stashing it in
    /// `pending_open` so the dispatch loop can drain it once Ready
    /// fires.
    editor_ready: bool,
    /// [`NoteOpen`] queued for delivery once the editor announces
    /// Ready.  Drained by the dispatch task on receipt of
    /// [`FromHost::Ready`].
    pending_open: Option<NoteOpen>,
    #[cfg(target_os = "macos")]
    macos: MacosState,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct MacosState {
    webview: Option<gpui::Entity<gpui_wry::WebView>>,
    last_bounds: FrameSyncState,
}

impl NoteItem {
    /// Create a `NoteItem` without a WebView — for cross-platform CI
    /// tests and host-less unit tests of the pure-logic surface.
    #[must_use]
    pub fn new_for_tests(note: Note) -> Self {
        Self {
            id: note.id,
            title: note.title,
            path: note.path,
            dirty: false,
            editor_ready: false,
            pending_open: None,
            #[cfg(target_os = "macos")]
            macos: MacosState::default(),
        }
    }

    /// Vault note identifier.
    #[must_use]
    pub fn id(&self) -> NoteId {
        self.id
    }

    /// On-disk path to the note (informational; persistence still goes
    /// through `vault::Vault::save`).
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Apply an incoming [`FromHost`] message to `self` and return the
    /// follow-up action the caller must schedule.  Pure logic — no
    /// `cx`, no IO, no async — so the dispatch state machine is fully
    /// unit-testable.
    pub fn apply_from_host(&mut self, msg: FromHost) -> Outcome {
        match msg {
            FromHost::Ready => {
                self.editor_ready = true;
                match self.pending_open.take() {
                    Some(p) => Outcome::DeliverPending(p),
                    None => Outcome::None,
                }
            }
            FromHost::Dirty(r) => {
                if self.check_own("Dirty", r.id) {
                    self.dirty = true;
                }
                Outcome::None
            }
            FromHost::Saved(r) => {
                if self.check_own("Saved", r.id) {
                    self.dirty = false;
                }
                Outcome::None
            }
            FromHost::Save(s) => {
                if !self.check_own("Save", s.id) {
                    return Outcome::None;
                }
                self.dirty = false;
                Outcome::PersistSave { body: s.body }
            }
            FromHost::LinkClick(l) => Outcome::NavigateLink(LinkTarget::classify(l.target)),
            FromHost::Keydown(k) => Outcome::DispatchKeydown(KeydownEvent {
                key: SharedString::from(k.key),
                mods: k.mods,
            }),
        }
    }

    /// `true` if `got` matches this item's id; logs a warning and
    /// returns `false` otherwise.  Centralises the foreign-id check
    /// so the `apply_from_host` arms can't drift apart.
    fn check_own(&self, kind: &str, got: NoteId) -> bool {
        if got == self.id {
            return true;
        }
        log::warn!(
            "note_item::apply_from_host: ignoring {kind} for foreign id {got:?} \
             (this NoteItem owns {own:?})",
            own = self.id,
        );
        false
    }

    /// Build the [`ToHost::NoteOpen`] message that should be the first
    /// thing the editor receives after it announces `Ready`.
    ///
    /// `body` is read from disk by the caller before construction so
    /// `NoteItem::new_for_tests` stays purely synchronous.
    #[must_use]
    pub fn initial_note_open(&self, body: String) -> ToHost {
        ToHost::NoteOpen(NoteOpen {
            id: self.id,
            path: self.path.display().to_string(),
            body,
        })
    }

    /// Swap the note hosted in this item's WebView **without**
    /// reconstructing the underlying WKWebView.  Updates `id`, `title`,
    /// `path`, clears the dirty flag, and dispatches a fresh
    /// [`ToHost::NoteOpen`] over the existing IPC channel.
    ///
    /// If the editor host has not yet emitted [`FromHost::Ready`], the
    /// `NoteOpen` is queued in `pending_open` and drained the moment
    /// Ready arrives — so the call is safe to make at any point in the
    /// WebView's lifecycle.
    ///
    /// Eliminates the flicker that came from constructing a new
    /// [`gpui_wry::WebView`] per note click in Phase 5d.
    ///
    /// # Errors
    ///
    /// Returns an error if [`encode_to_host`] fails (should not happen
    /// — `NoteOpen` is serialisable by construction) or if the
    /// underlying [`wry::WebView::evaluate_script`] call fails.
    pub fn open_in_webview(
        &mut self,
        note: Note,
        body: String,
        cx: &mut Context<Self>,
    ) -> Result<()> {
        self.id = note.id;
        self.title = note.title;
        self.path = note.path;
        self.dirty = false;

        let payload = NoteOpen {
            id: self.id,
            path: self.path.display().to_string(),
            body,
        };

        if self.editor_ready {
            self.send_note_open(payload, cx)?;
        } else {
            self.pending_open = Some(payload);
        }
        cx.notify();
        Ok(())
    }

    /// Forward the GPUI theme mode to the embedded editor's
    /// `document.documentElement` so the WKWebView body restyles in
    /// lockstep with the native chrome (Phase 7.9).
    ///
    /// Uses raw `document.documentElement.dataset.theme = ...`
    /// assignment instead of the `tolariaBridge` IPC path — the
    /// dataset is reflected the moment the document is parsed, so
    /// theme changes apply even before the editor announces
    /// [`FromHost::Ready`] and installs the bridge.
    ///
    /// # Errors
    ///
    /// Returns an error if [`wry::WebView::evaluate_script`] fails
    /// (process crashed, handle invalid, etc.).
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    pub fn set_theme(&self, mode: ThemeMode, cx: &Context<Self>) -> Result<()> {
        #[cfg(target_os = "macos")]
        if let Some(webview) = self.macos.webview.as_ref() {
            // Two known-safe ASCII tokens — no escaping needed.
            // Inlining as a literal also makes it obvious by
            // inspection that no attacker-controlled bytes can reach
            // `evaluate_script`.
            let mode_str = match mode {
                ThemeMode::Light => "light",
                ThemeMode::Dark => "dark",
            };
            let js = format!(r#"document.documentElement.dataset.theme = "{mode_str}";"#);
            webview
                .read(cx)
                .raw()
                .evaluate_script(&js)
                .context("wry::WebView::evaluate_script(ThemeSet) failed")?;
        }
        Ok(())
    }

    /// Serialise `msg` and inject it into the embedded WKWebView via
    /// `tolariaBridge.receive(...)`.  `label` is included in every
    /// `# Errors` context message so the failure point is identifiable
    /// without backtracking through stack frames.  No-op on non-macOS
    /// builds.  Shared by [`Self::send_note_open`] and
    /// [`Self::send_save_request`] (and any future single-message
    /// dispatch path) so the encode → JS-literal → `evaluate_script`
    /// pipeline lives in exactly one place.
    ///
    /// # Errors
    ///
    /// - [`encode_to_host`] fails (should not happen for a typed
    ///   [`ToHost`], but propagated rather than panicked).
    /// - Re-encoding the JSON envelope as a JS string literal fails.
    /// - [`wry::WebView::evaluate_script`] fails (process crashed,
    ///   handle invalid, etc.).
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    fn send_to_host(&self, msg: &ToHost, label: &'static str, cx: &Context<Self>) -> Result<()> {
        let json =
            encode_to_host(msg).with_context(|| format!("encode_to_host({label}) failed"))?;
        #[cfg(target_os = "macos")]
        if let Some(webview) = self.macos.webview.as_ref() {
            // The second `to_string` re-encodes the JSON payload as a
            // properly-escaped JS string literal (quotes, backslashes,
            // control chars) — safe argument to `receive(...)`.
            let payload_js = serde_json::to_string(&json)
                .with_context(|| format!("re-encode {label} JSON as JS string literal"))?;
            let js = format!("window.tolariaBridge && window.tolariaBridge.receive({payload_js});");
            webview
                .read(cx)
                .raw()
                .evaluate_script(&js)
                .with_context(|| format!("wry::WebView::evaluate_script({label}) failed"))?;
        }
        Ok(())
    }

    /// Dispatch [`ToHost::SaveRequest`] into the WKWebView.  No-op on
    /// non-macOS builds.  Used by [`Item::save`] (Phase 8.3) so the
    /// workspace's save action reaches the embedded editor over the
    /// same bridge the local Cmd+S handler already uses.
    ///
    /// # Errors
    ///
    /// Same failure conditions as [`Self::send_to_host`]:
    /// - [`encode_to_host`] failure,
    /// - JSON-literal re-encode failure,
    /// - [`wry::WebView::evaluate_script`] failure.
    fn send_save_request(&self, cx: &Context<Self>) -> Result<()> {
        self.send_to_host(&ToHost::SaveRequest, "SaveRequest", cx)
    }

    /// Serialise `payload` and inject it into the WKWebView via
    /// `tolariaBridge.receive(...)`.  No-op on non-macOS builds.
    ///
    /// `tolariaBridge` is installed by editor-host's `onReceive` call
    /// once `ready` has been announced.  The dispatch loop only calls
    /// this after `editor_ready` is `true`, so the global is
    /// guaranteed to be present.
    ///
    /// # Errors
    ///
    /// Same failure conditions as [`Self::send_to_host`]:
    /// - [`encode_to_host`] failure (should not happen for a typed
    ///   [`NoteOpen`], but propagated rather than panicked),
    /// - JSON-literal re-encode failure,
    /// - [`wry::WebView::evaluate_script`] failure.
    fn send_note_open(&self, payload: NoteOpen, cx: &Context<Self>) -> Result<()> {
        self.send_to_host(&ToHost::NoteOpen(payload), "NoteOpen", cx)
    }

    /// Spawn a detached foreground task that drains `rx` and routes
    /// each [`FromHost`] message through [`apply_from_host`][Self::apply_from_host].
    /// `PersistSave` outcomes call `vault::Vault::save` via the global
    /// (if installed).  The task exits when the channel closes or the
    /// entity is dropped.
    ///
    /// Extracted so unit tests can wire a `flume::Sender` /
    /// `Receiver` pair directly without spawning a real WKWebView.
    /// `new_with_webview` calls this internally.
    pub fn install_dispatch_task(
        entity: gpui::WeakEntity<Self>,
        rx: flume::Receiver<FromHost>,
        cx: &mut App,
    ) {
        cx.spawn(async move |cx| {
            while let Ok(msg) = rx.recv_async().await {
                let Some(this) = entity.upgrade() else {
                    break;
                };
                this.update(cx, |this, cx| match this.apply_from_host(msg) {
                    Outcome::PersistSave { body } => {
                        let id = this.id();
                        if cx.has_global::<vault::Vault>() {
                            // `Vault::save` is sync for MVP — the
                            // returned Task is immediately ready.
                            // Detach so the dispatch loop doesn't await
                            // it (would re-enter the foreground executor).
                            cx.global_mut::<vault::Vault>().save(id, &body).detach();
                            log::info!(
                                target: "note_item::ipc",
                                "vault.save({id:?}) issued ({} bytes)",
                                body.len(),
                            );
                        } else {
                            log::warn!(
                                target: "note_item::ipc",
                                "PersistSave outcome but no Vault global installed; \
                                 body dropped (note id={id:?})"
                            );
                        }
                    }
                    Outcome::DeliverPending(pending) => {
                        if let Err(e) = this.send_note_open(pending, cx) {
                            log::warn!(
                                target: "note_item::ipc",
                                "draining pending NoteOpen failed: {e:#}"
                            );
                        }
                    }
                    Outcome::NavigateLink(target) => {
                        cx.emit(LinkClickEvent { target });
                    }
                    Outcome::DispatchKeydown(keydown) => cx.emit(keydown),
                    Outcome::None => {}
                });
            }
        })
        .detach();
    }
}

impl EventEmitter<LinkClickEvent> for NoteItem {}
impl EventEmitter<KeydownEvent> for NoteItem {}

impl Item for NoteItem {
    fn tab_content_text(&self, _cx: &App) -> SharedString {
        self.title.clone()
    }

    fn can_save(&self) -> bool {
        true
    }

    fn is_dirty(&self) -> bool {
        self.dirty
    }

    fn save(&mut self, cx: &mut Context<Self>) -> Task<Result<()>> {
        // Phase 8.3: relay a `ToHost::SaveRequest` into the embedded
        // editor.  The editor responds with `FromHost::Save { body }`
        // (or `FromHost::Saved` if the buffer is already clean), the
        // dispatch task picks that up via `apply_from_host`, and on
        // `Outcome::PersistSave` calls `vault::Vault::save`.  This
        // method completes once the request is dispatched — the
        // editor's response drives the actual persistence
        // asynchronously through the dispatch task already wired in
        // Phase 5e.
        //
        // Returning `Task::ready(...)` here (rather than a real
        // one-shot that observes `Outcome::PersistSave`) keeps the
        // save flow non-blocking: the workspace's save action returns
        // immediately, and the dirty-flag gets cleared the moment the
        // editor's `FromHost::Save` arrives.  A blocking variant that
        // awaits the round-trip is recorded in the Phase 9.5
        // `auto_git` design as a follow-up if checkpoint flushes
        // require synchronous completion.
        Task::ready(self.send_save_request(cx))
    }
}

impl Render for NoteItem {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // Skip the breadcrumb + action row when the blank placeholder
        // WebView is mounted — `new_blank_with_webview` constructs the
        // entity with `path = PathBuf::new()`, and neither cluster has
        // meaningful state to render until a note swaps in.
        let toolbar =
            (!self.path.as_os_str().is_empty()).then(|| note_toolbar::render(&self.path, cx));

        let container = v_flex().size_full().children(toolbar);

        #[cfg(target_os = "macos")]
        {
            if let Some(webview) = self.macos.webview.clone() {
                return container.child(div().flex_1().child(InstrumentedWebView::new(
                    webview,
                    self.macos.last_bounds.clone(),
                )));
            }
        }
        container
    }
}

#[cfg(target_os = "macos")]
impl NoteItem {
    /// Build an *empty* `NoteItem` with a live WKWebView but no note
    /// mounted.  The editor host renders its "Select a note…"
    /// placeholder until [`open_in_webview`][Self::open_in_webview]
    /// swaps a real note into it.
    ///
    /// Construction is the heavy step (NSView allocation, HTML load,
    /// JS bootstrap — about 100-300 ms).  Calling this at workspace
    /// startup means the user never sees the black NSView flash that
    /// would otherwise occur on the first click.
    ///
    /// # Errors
    ///
    /// Same conditions as [`new_with_webview`][Self::new_with_webview]
    /// — window-handle race, sandboxed CI host, wry build failure.
    pub fn new_blank_with_webview(window: &mut Window, cx: &mut App) -> Result<gpui::Entity<Self>> {
        use gpui::AppContext as _;

        let (tx, rx) = flume::unbounded::<FromHost>();
        let webview = spawn_webview(NoteId::from_raw(0), tx, window, cx)?;

        let entity = cx.new(|_cx| Self {
            id: NoteId::from_raw(0),
            title: SharedString::default(),
            path: PathBuf::new(),
            dirty: false,
            editor_ready: false,
            pending_open: None,
            macos: MacosState {
                webview: Some(webview),
                last_bounds: FrameSyncState::default(),
            },
        });

        Self::install_dispatch_task(entity.downgrade(), rx, cx);

        Ok(entity)
    }

    /// Build a `NoteItem` with a live WKWebView hosting the embedded
    /// editor and a foreground task that routes IPC messages from the
    /// editor back into the entity.  macOS only.
    ///
    /// `body` is the on-disk content as of construction; it is queued
    /// in `pending_open` and delivered to the editor host as a
    /// [`ToHost::NoteOpen`] the moment [`FromHost::Ready`] arrives.
    ///
    /// # Errors
    ///
    /// Returns an error if the window handle is unavailable (no
    /// foreground window during a race) or if `wry::WebViewBuilder`
    /// fails to construct the underlying NSView (sandbox restriction,
    /// headless CI host, …).  Both are recoverable — the caller
    /// should surface a toast rather than panic.
    pub fn new_with_webview(
        note: Note,
        body: String,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<gpui::Entity<Self>> {
        use gpui::AppContext as _;

        let (tx, rx) = flume::unbounded::<FromHost>();
        let webview = spawn_webview(note.id, tx, window, cx)?;
        let pending_open = NoteOpen {
            id: note.id,
            path: note.path.display().to_string(),
            body,
        };

        let entity = cx.new(|_cx| Self {
            id: note.id,
            title: note.title,
            path: note.path,
            dirty: false,
            editor_ready: false,
            pending_open: Some(pending_open),
            macos: MacosState {
                webview: Some(webview),
                last_bounds: FrameSyncState::default(),
            },
        });

        // Route editor IPC messages back into the entity.  The task
        // exits when the channel closes (which happens when the
        // WebView's IPC sender drops together with the entity).
        Self::install_dispatch_task(entity.downgrade(), rx, cx);

        Ok(entity)
    }
}

// ---------------------------------------------------------------------------
// macOS WebView glue
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod macos {
    use super::{NoteId, EDITOR_HOST_HTML};
    use anyhow::{Context as _, Result};
    use gpui::{
        App, AppContext, Bounds, Context, Element, ElementId, Entity, GlobalElementId, IntoElement,
        LayoutId, Pixels, Size as GpuiSize, Style, Window,
    };
    use gpui_wry::WebView;
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSColor, NSView};
    use objc2_foundation::{ns_string, NSNumber, NSObjectNSKeyValueCoding};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::{cell::Cell, rc::Rc};
    use wry::{
        dpi::{self, LogicalPosition, LogicalSize},
        Rect, WebViewBuilder, WebViewExtMacOS,
    };

    /// 0.5-logical-pixel epsilon per ADR-0115 §4.  Mirrors
    /// `embed_poc::webview::FRAME_EPSILON` — the bytes-identical value
    /// keeps the two crates' frame-sync behaviour observably the same.
    pub const FRAME_EPSILON: f32 = 0.5;

    /// Shared bounds-tracking state used by [`InstrumentedWebView`] to
    /// dedupe no-op `set_bounds` calls.  Default constructs the empty
    /// state (`Rc::new(Cell::new(None))`).
    pub type FrameSyncState = Rc<Cell<Option<Bounds<Pixels>>>>;

    /// Build the per-note WKWebView with the embedded editor host
    /// bundle pre-loaded.  The IPC handler logs each parsed
    /// [`editor_bridge::FromHost`] message; Phase 5-MVP swaps the
    /// logger for a channel that routes messages back to the
    /// `NoteItem` entity.
    ///
    /// # Errors
    ///
    /// - No window handle available (no foreground window during a race).
    /// - `wry::WebViewBuilder::build_as_child` failure.
    pub fn spawn_webview(
        id: NoteId,
        tx: flume::Sender<editor_bridge::FromHost>,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<Entity<WebView>> {
        let handle = window
            .window_handle()
            .context("window handle unavailable while building NoteItem WebView")?;

        // NOTE: `WebViewBuilder::with_background_color` is a no-op on
        // macOS in `lb-wry` 0.53.3 (only the iOS path applies the
        // color).  The "black flash" before the first paint is
        // therefore solved upstream: we eagerly construct the
        // `NoteItem` at workspace startup (see
        // `crate::open_note::preload_first_note`) so the WKWebView is
        // already painted by the time the user clicks anything.

        let webview_raw = WebViewBuilder::new()
            .with_html(EDITOR_HOST_HTML)
            .with_ipc_handler(move |req| {
                let body = req.body();
                match editor_bridge::decode_from_host(body) {
                    Ok(msg) => {
                        if tx.send(msg).is_err() {
                            log::warn!(
                                target: "note_item::ipc",
                                "ipc id={id:?}: dispatch channel closed; message dropped"
                            );
                        }
                    }
                    Err(e) => log::warn!(
                        target: "note_item::ipc",
                        "ipc id={id:?} decode_failed body={body:?} err={e}",
                    ),
                }
            })
            .build_as_child(&handle)
            .context("wry::WebViewBuilder::build_as_child failed")?;

        // Seamless-resize fixes (mirrors embed_poc::spawn_test_webview).
        // Must run on the bare wry::WebView before WebView::new wraps it
        // in an Rc.  See follow-up plan §4 / §6 for rationale.
        fix_autoresize_mask(&webview_raw);
        fix_draws_background(&webview_raw);
        fix_window_background(&handle);
        fix_under_page_background(&webview_raw);

        Ok(cx.new(|cx: &mut Context<WebView>| WebView::new(webview_raw, window, cx)))
    }

    /// Fix 1 — Autoresize mask (mirrors `embed_poc::fix_autoresize_mask`).
    ///
    /// lb-wry's `build_as_child` sets `ViewMinYMargin` only.  Override to
    /// `ViewWidthSizable | ViewHeightSizable` so AppKit propagates frame
    /// changes to the WKWebView during live-resize inside its own geometry
    /// phase — eliminating one latency source in the trailing-strip artifact.
    fn fix_autoresize_mask(webview: &wry::WebView) {
        let wk: objc2::rc::Retained<wry::WryWebView> = webview.webview();
        wk.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
    }

    /// Fix 2 — `drawsBackground = false` (mirrors `embed_poc::fix_draws_background`).
    ///
    /// Suppresses WebKit's own opaque-white fill during resize so only the
    /// GPUI Metal surface (and ultimately the WKWebView's own content) is
    /// visible.
    fn fix_draws_background(webview: &wry::WebView) {
        let wk: objc2::rc::Retained<wry::WryWebView> = webview.webview();
        let no = NSNumber::numberWithBool(false);
        // SAFETY: KVC `setValue:forKey:` on a live WKWebView instance on the
        // main thread.  `drawsBackground` is a documented WKWebView property
        // (macOS 10.14+).  `wk` is ARC-retained and not aliased.
        unsafe { wk.setValue_forKey(Some(&no), ns_string!("drawsBackground")) }
    }

    /// Fix 3 — NSWindow background colour (mirrors `embed_poc::fix_window_background`).
    ///
    /// Sets `NSWindow.backgroundColor` to `theme.background` (dark `#1F1E1B`,
    /// light `#FFFFFF`) so any 1-frame gap between the Metal layer and the
    /// WKWebView's remote CALayer is filled with the matching colour rather
    /// than the default light-grey chrome.
    ///
    /// # Safety
    /// Unsafe pointer cast from `AppKitWindowHandle.ns_view` + objc2 retain.
    fn fix_window_background(window_handle: &impl HasWindowHandle) {
        let Ok(handle) = window_handle.window_handle() else {
            log::warn!("note_item::fix_window_background: could not obtain window handle");
            return;
        };
        let RawWindowHandle::AppKit(appkit) = handle.as_raw() else {
            log::warn!("note_item::fix_window_background: window handle is not AppKit");
            return;
        };
        // SAFETY: `ns_view` is a valid, live NSView pointer for the duration
        // of this call.  We retain it temporarily, walk to NSWindow, and set
        // the background colour.  All on the main thread.
        unsafe {
            let ns_view_ptr: *mut NSView = appkit.ns_view.as_ptr().cast();
            let Some(ns_view) = objc2::rc::Retained::retain(ns_view_ptr) else {
                log::warn!("note_item::fix_window_background: NSView retain returned nil");
                return;
            };
            let Some(ns_window) = ns_view.window() else {
                log::warn!("note_item::fix_window_background: NSView.window() returned nil");
                return;
            };
            // Dark theme: `theme.palette::apply_dark` background = #1F1E1B.
            // Light theme: #FFFFFF.  We cannot read the live theme here
            // because this runs during WebView construction before any
            // GPUI render pass.  Use the dark value as the safe default
            // (matches the `drawsBackground = false` intent and is
            // invisible under normal compositing).  A theme-change observer
            // in `main.rs` can update this later if needed.
            let color = NSColor::colorWithSRGBRed_green_blue_alpha(
                0x1F_u8 as f64 / 255.0,
                0x1E_u8 as f64 / 255.0,
                0x1B_u8 as f64 / 255.0,
                1.0,
            );
            ns_window.setBackgroundColor(Some(&color));
        }
    }

    /// Fix 4 — `underPageBackgroundColor` (new, not in embed_poc).
    ///
    /// Sets `WKWebView.underPageBackgroundColor` to `theme.background` so the
    /// colour WebKit paints in the gap region (when the remote CALayer hasn't
    /// yet committed its new geometry) matches the GPUI Metal surface colour.
    /// This makes the 1-frame IPC lag invisible in both light and dark mode.
    ///
    /// `underPageBackgroundColor` is macOS 12+ API; on earlier releases the
    /// KVC write is silently ignored.
    fn fix_under_page_background(webview: &wry::WebView) {
        let wk: objc2::rc::Retained<wry::WryWebView> = webview.webview();
        // Dark background (#1F1E1B).  See fix_window_background comment for
        // why we use the dark value as the safe default.
        let color = NSColor::colorWithSRGBRed_green_blue_alpha(
            0x1F_u8 as f64 / 255.0,
            0x1E_u8 as f64 / 255.0,
            0x1B_u8 as f64 / 255.0,
            1.0,
        );
        // SAFETY: KVC `setValue:forKey:` on a live WKWebView instance on the
        // main thread.  `underPageBackgroundColor` is macOS 12+ (silently
        // ignored on earlier releases).  `wk` is ARC-retained and not aliased.
        unsafe { wk.setValue_forKey(Some(&color), ns_string!("underPageBackgroundColor")) }
    }

    /// Custom `Element` mirroring `embed_poc::InstrumentedWebView`.
    /// Wraps a [`WebView`] entity with an epsilon-compare guard so
    /// no-op `set_bounds` calls don't ping the underlying NSView.
    pub struct InstrumentedWebView {
        webview: Entity<WebView>,
        last_bounds: FrameSyncState,
    }

    impl InstrumentedWebView {
        /// Wrap a [`WebView`] entity in the frame-sync-deduped Element.
        /// `last_bounds` is the shared bounds-tracking cell that lets
        /// the epsilon guard survive across render passes (created
        /// once per `NoteItem` in `NoteItem::new_with_webview`).
        pub fn new(webview: Entity<WebView>, last_bounds: FrameSyncState) -> Self {
            Self {
                webview,
                last_bounds,
            }
        }
    }

    impl IntoElement for InstrumentedWebView {
        type Element = Self;
        fn into_element(self) -> Self::Element {
            self
        }
    }

    impl Element for InstrumentedWebView {
        type RequestLayoutState = ();
        type PrepaintState = ();

        fn id(&self) -> Option<ElementId> {
            None
        }

        fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
            None
        }

        fn request_layout(
            &mut self,
            _: Option<&GlobalElementId>,
            _: Option<&gpui::InspectorElementId>,
            window: &mut Window,
            cx: &mut App,
        ) -> (LayoutId, Self::RequestLayoutState) {
            let style = Style {
                size: GpuiSize::full(),
                flex_shrink: 1.0,
                ..Default::default()
            };
            (window.request_layout(style, [], cx), ())
        }

        fn prepaint(
            &mut self,
            _: Option<&GlobalElementId>,
            _: Option<&gpui::InspectorElementId>,
            bounds: Bounds<Pixels>,
            _: &mut Self::RequestLayoutState,
            _: &mut Window,
            cx: &mut App,
        ) -> Self::PrepaintState {
            let prev = self.last_bounds.get();
            if prev.map(|p| close_enough(p, bounds)).unwrap_or(false) {
                return;
            }
            let rect = Rect {
                size: dpi::Size::Logical(LogicalSize {
                    width: bounds.size.width.into(),
                    height: bounds.size.height.into(),
                }),
                position: dpi::Position::Logical(LogicalPosition::new(
                    bounds.origin.x.into(),
                    bounds.origin.y.into(),
                )),
            };
            // On Err do NOT advance `last_bounds` — the epsilon guard
            // would suppress the next prepaint and the NSView would
            // stay stuck at the pre-resize geometry.  Log so the
            // visual stutter has a paper trail.
            if let Err(e) = self.webview.read(cx).set_bounds(rect) {
                log::warn!(
                    target: "note_item::frame_sync",
                    "set_bounds failed; geometry will retry on next prepaint err={e:?}",
                );
                return;
            }
            self.last_bounds.set(Some(bounds));
        }

        fn paint(
            &mut self,
            _: Option<&GlobalElementId>,
            _: Option<&gpui::InspectorElementId>,
            _: Bounds<Pixels>,
            _: &mut Self::RequestLayoutState,
            _: &mut Self::PrepaintState,
            _: &mut Window,
            _: &mut App,
        ) {
        }
    }

    fn close_enough(a: Bounds<Pixels>, b: Bounds<Pixels>) -> bool {
        let dx = (f32::from(a.origin.x) - f32::from(b.origin.x)).abs();
        let dy = (f32::from(a.origin.y) - f32::from(b.origin.y)).abs();
        let dw = (f32::from(a.size.width) - f32::from(b.size.width)).abs();
        let dh = (f32::from(a.size.height) - f32::from(b.size.height)).abs();
        dx < FRAME_EPSILON && dy < FRAME_EPSILON && dw < FRAME_EPSILON && dh < FRAME_EPSILON
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use editor_bridge::{Keydown, LinkClick, NoteRef, NoteSave};
    use std::path::PathBuf;

    fn fresh_note(id: u64) -> Note {
        Note {
            id: NoteId::from_raw(id),
            title: SharedString::from(format!("Note {id}")),
            path: PathBuf::from(format!("/v/n-{id}.md")),
            kind: vault::NoteKind::Markdown,
            modified: Utc::now(),
            byte_size: 0,
            frontmatter: vault::Frontmatter::default(),
        }
    }

    #[test]
    fn apply_dirty_sets_dirty_flag() {
        let mut item = NoteItem::new_for_tests(fresh_note(1));
        assert!(!item.is_dirty());
        let outcome = item.apply_from_host(FromHost::Dirty(NoteRef { id: item.id }));
        assert_eq!(outcome, Outcome::None);
        assert!(item.is_dirty());
    }

    #[test]
    fn apply_save_clears_dirty_and_yields_persist_outcome() {
        let mut item = NoteItem::new_for_tests(fresh_note(1));
        item.apply_from_host(FromHost::Dirty(NoteRef { id: item.id }));
        assert!(item.is_dirty());
        let outcome = item.apply_from_host(FromHost::Save(NoteSave {
            id: item.id,
            body: "new body".into(),
        }));
        assert_eq!(
            outcome,
            Outcome::PersistSave {
                body: "new body".into(),
            }
        );
        assert!(!item.is_dirty(), "save must clear dirty");
    }

    #[test]
    fn apply_saved_clears_dirty_without_persist() {
        let mut item = NoteItem::new_for_tests(fresh_note(1));
        item.apply_from_host(FromHost::Dirty(NoteRef { id: item.id }));
        let outcome = item.apply_from_host(FromHost::Saved(NoteRef { id: item.id }));
        assert_eq!(outcome, Outcome::None);
        assert!(!item.is_dirty());
    }

    #[test]
    fn apply_link_click_classifies_wikilink() {
        let mut item = NoteItem::new_for_tests(fresh_note(1));
        let outcome = item.apply_from_host(FromHost::LinkClick(LinkClick {
            target: "OtherNote".into(),
        }));
        assert_eq!(
            outcome,
            Outcome::NavigateLink(LinkTarget::Wikilink("OtherNote".into())),
        );
    }

    #[test]
    fn apply_link_click_classifies_https_url() {
        let mut item = NoteItem::new_for_tests(fresh_note(1));
        let outcome = item.apply_from_host(FromHost::LinkClick(LinkClick {
            target: "https://example.com".into(),
        }));
        assert_eq!(
            outcome,
            Outcome::NavigateLink(LinkTarget::Url("https://example.com".into())),
        );
    }

    #[test]
    fn apply_link_click_classifies_mailto() {
        let outcome = LinkTarget::classify("mailto:a@b.com".into());
        assert_eq!(outcome, LinkTarget::Url("mailto:a@b.com".into()));
    }

    #[test]
    fn apply_keydown_yields_dispatch_keydown_outcome() {
        let mut item = NoteItem::new_for_tests(fresh_note(1));
        let mods = Mods {
            meta: true,
            ..Default::default()
        };
        let outcome = item.apply_from_host(FromHost::Keydown(Keydown {
            key: "s".into(),
            mods,
        }));
        assert_eq!(
            outcome,
            Outcome::DispatchKeydown(KeydownEvent {
                key: SharedString::from("s"),
                mods,
            }),
            "Keydown must surface as DispatchKeydown carrying the canonical event shape"
        );
        // Keydown is an out-of-band signal; it must not mutate dirty state.
        assert!(!item.is_dirty());
    }

    #[test]
    fn apply_foreign_id_dirty_does_not_mark_self_dirty() {
        let mut item = NoteItem::new_for_tests(fresh_note(1));
        let outcome = item.apply_from_host(FromHost::Dirty(NoteRef {
            id: NoteId::from_raw(999),
        }));
        assert_eq!(outcome, Outcome::None);
        assert!(
            !item.is_dirty(),
            "foreign-id Dirty must not mark this NoteItem dirty"
        );
    }

    #[test]
    fn apply_foreign_id_save_does_not_emit_persist_outcome() {
        let mut item = NoteItem::new_for_tests(fresh_note(1));
        let outcome = item.apply_from_host(FromHost::Save(NoteSave {
            id: NoteId::from_raw(999),
            body: "x".into(),
        }));
        assert_eq!(outcome, Outcome::None, "foreign-id Save must not persist");
    }

    #[test]
    fn initial_note_open_carries_path_and_id() {
        let item = NoteItem::new_for_tests(fresh_note(7));
        let msg = item.initial_note_open("body".into());
        match msg {
            ToHost::NoteOpen(p) => {
                assert_eq!(p.id, item.id);
                assert_eq!(p.body, "body");
                assert!(p.path.contains("n-7.md"));
            }
            other => panic!("expected NoteOpen, got {other:?}"),
        }
    }

    #[test]
    fn path_returns_path_not_pathbuf() {
        // Type-locks the return signature so future drift to
        // `&PathBuf` would fail to compile.
        let item = NoteItem::new_for_tests(fresh_note(1));
        let p: &Path = item.path();
        assert!(p.ends_with("n-1.md"));
    }

    #[test]
    fn embedded_editor_html_contains_mount_point() {
        // Asserts the literal markup so a stray comment containing
        // "editor-root" wouldn't satisfy the check.
        assert!(
            EDITOR_HOST_HTML.contains(r#"id="editor-root""#),
            "EDITOR_HOST_HTML must contain `<div id=\"editor-root\">`; \
             rebuild editor-host/dist with `pnpm --ignore-workspace build`"
        );
    }

    #[test]
    fn ready_marks_editor_ready_flag() {
        let mut item = NoteItem::new_for_tests(fresh_note(1));
        assert!(!item.editor_ready, "fresh NoteItem must not be ready yet");
        let outcome = item.apply_from_host(FromHost::Ready);
        assert_eq!(outcome, Outcome::None);
        assert!(
            item.editor_ready,
            "apply_from_host(Ready) must flip editor_ready so pending_open drains"
        );
    }

    /// Ready with a queued `NoteOpen` must surface
    /// [`Outcome::DeliverPending`] and clear `pending_open`.  Locks
    /// the state-machine contract that the dispatch loop relies on.
    #[test]
    fn ready_with_pending_open_emits_deliver_pending() {
        let mut item = NoteItem::new_for_tests(fresh_note(7));
        let queued = NoteOpen {
            id: item.id,
            path: item.path.display().to_string(),
            body: "queued body".into(),
        };
        item.pending_open = Some(queued.clone());
        let outcome = item.apply_from_host(FromHost::Ready);
        assert_eq!(outcome, Outcome::DeliverPending(queued));
        assert!(item.editor_ready);
        assert!(
            item.pending_open.is_none(),
            "pending_open must be drained when DeliverPending is emitted"
        );
    }

    /// Regression for the Phase 5d-followup flicker fix: swapping the
    /// hosted note via `open_in_webview` updates id/title/path/dirty
    /// atomically and queues the [`NoteOpen`] payload until the editor
    /// announces `Ready`.  Locks the reuse contract that
    /// `crate::open_note::open_note` relies on to keep a single
    /// WKWebView alive across note clicks.
    #[gpui::test]
    fn open_in_webview_swaps_state_and_queues_until_ready(cx: &mut gpui::TestAppContext) {
        use gpui::AppContext as _;

        let a = fresh_note(1);
        let b = fresh_note(2);
        let entity = cx.update(|cx| cx.new(|_| NoteItem::new_for_tests(a.clone())));

        // Before Ready, `open_in_webview` must queue the payload.
        cx.update(|cx| {
            entity.update(cx, |item, cx| {
                // Force-dirty so we can prove the swap clears it.
                item.dirty = true;
                item.open_in_webview(b.clone(), "body B".into(), cx)
                    .expect("queue NoteOpen");
                assert_eq!(item.id(), b.id);
                assert!(!item.is_dirty(), "open_in_webview must clear dirty");
                match &item.pending_open {
                    Some(p) => {
                        assert_eq!(p.id, b.id);
                        assert_eq!(p.body, "body B");
                    }
                    None => panic!("pending_open must hold the queued NoteOpen before Ready"),
                }
            });
        });

        // After Ready, dispatch the pending payload would normally fire
        // via the dispatch task; here we exercise the
        // `editor_ready=true` path directly by simulating Ready and
        // calling `open_in_webview` again — it must *not* queue.
        cx.update(|cx| {
            entity.update(cx, |item, cx| {
                item.apply_from_host(FromHost::Ready);
                // No live WebView in the test fixture, so the send is a
                // no-op; the important contract is that `pending_open`
                // is *not* re-populated on the Ready path.
                item.pending_open = None;
                item.open_in_webview(a.clone(), "body A".into(), cx)
                    .expect("send NoteOpen");
                assert_eq!(item.id(), a.id);
                assert!(
                    item.pending_open.is_none(),
                    "post-Ready open_in_webview must dispatch directly, not queue"
                );
            });
        });
    }

    /// End-to-end: `install_dispatch_task` routes a `FromHost::Save`
    /// arriving on the channel through `apply_from_host`, the
    /// resulting `Outcome::PersistSave` triggers `vault::Vault::save`,
    /// and the body lands on disk.  Phase 5e MVP CUT criterion.
    #[gpui::test]
    fn dispatch_task_persists_save_to_vault(cx: &mut gpui::TestAppContext) {
        use gpui::AppContext as _;
        use std::fs;

        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("note.md");
        fs::write(&path, "initial").unwrap();
        let vault = vault::Vault::open_at(dir.path()).expect("open vault");
        let (note_id, note) = cx.update(|cx| {
            let executor = cx.foreground_executor().clone();
            let ids = executor.block_on(vault.notes());
            let id = ids[0];
            let note = executor.block_on(vault.note(id)).expect("note exists");
            (id, note)
        });
        cx.update(|cx| cx.set_global(vault));

        let entity = cx.update(|cx| cx.new(|_| NoteItem::new_for_tests(note)));
        let (tx, rx) = flume::unbounded::<FromHost>();
        cx.update(|cx| NoteItem::install_dispatch_task(entity.downgrade(), rx, cx));

        tx.send(FromHost::Save(NoteSave {
            id: note_id,
            body: "rewritten by dispatch task".into(),
        }))
        .unwrap();
        cx.run_until_parked();

        let on_disk = fs::read_to_string(&path).unwrap();
        assert_eq!(
            on_disk, "rewritten by dispatch task",
            "FromHost::Save must persist through the dispatch task into vault::Vault::save"
        );
    }

    /// Phase 8.3 — `FromHost::LinkClick` arriving on the channel must
    /// surface as `LinkClickEvent` to entity subscribers, classified as
    /// the appropriate `LinkTarget` variant.
    #[gpui::test]
    fn dispatch_task_emits_link_click_event(cx: &mut gpui::TestAppContext) {
        use gpui::AppContext as _;
        use std::cell::RefCell;
        use std::rc::Rc;

        let entity = cx.update(|cx| cx.new(|_| NoteItem::new_for_tests(fresh_note(1))));
        let (tx, rx) = flume::unbounded::<FromHost>();
        cx.update(|cx| NoteItem::install_dispatch_task(entity.downgrade(), rx, cx));

        let received: Rc<RefCell<Vec<LinkClickEvent>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&entity, move |_entity, event: &LinkClickEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        tx.send(FromHost::LinkClick(LinkClick {
            target: "OtherNote".into(),
        }))
        .unwrap();
        tx.send(FromHost::LinkClick(LinkClick {
            target: "https://example.com".into(),
        }))
        .unwrap();
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(
            got,
            vec![
                LinkClickEvent {
                    target: LinkTarget::Wikilink("OtherNote".into()),
                },
                LinkClickEvent {
                    target: LinkTarget::Url("https://example.com".into()),
                },
            ],
            "dispatch task must emit LinkClickEvent with the classified target"
        );
    }

    /// Phase 8.3 — `FromHost::Keydown` arriving on the channel must
    /// surface as `KeydownEvent` to entity subscribers, preserving the
    /// key + mods reported by the editor.
    #[gpui::test]
    fn dispatch_task_emits_keydown_event(cx: &mut gpui::TestAppContext) {
        use gpui::AppContext as _;
        use std::cell::RefCell;
        use std::rc::Rc;

        let entity = cx.update(|cx| cx.new(|_| NoteItem::new_for_tests(fresh_note(1))));
        let (tx, rx) = flume::unbounded::<FromHost>();
        cx.update(|cx| NoteItem::install_dispatch_task(entity.downgrade(), rx, cx));

        let received: Rc<RefCell<Vec<KeydownEvent>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&entity, move |_entity, event: &KeydownEvent, _cx| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        tx.send(FromHost::Keydown(Keydown {
            key: "s".into(),
            mods: Mods {
                meta: true,
                ..Default::default()
            },
        }))
        .unwrap();
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(got.len(), 1, "dispatch task must emit a KeydownEvent");
        assert_eq!(got[0].key.as_ref(), "s");
        assert!(got[0].mods.meta);
    }
}
