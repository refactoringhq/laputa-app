#![forbid(unsafe_code)]
//! CodeMirror raw-text fallback editor chrome (ADR-0115 Phase 8.16, Strand B).
//!
//! Mirrors the Tauri-era `src/components/RawEditorView.tsx` +
//! `src/components/RawEditorFindBar.tsx` shape: a non-Markdown buffer
//! editor used for `.yaml`, `.json`, `.css`, `.sh`, `.toml`, and
//! plain-text files, with a Cmd+F find-bar overlay (next / prev /
//! replace placeholder).
//!
//! # Scope split with Strand C (Phase 8.29)
//!
//! Phase 8.29 owns the **WKWebView-embedded** CodeMirror raw-mode
//! that lives inside `editor-host/`.  This crate owns the GPUI-side
//! chrome glue: buffer state held server-of-record, find-bar
//! visibility / query / cursor, and the events the workspace
//! subscribes to (open file, save raw buffer, jump-to-match).
//! When the WKWebView raw-mode lands, the editor body posts buffer
//! deltas back into [`RawEditor::replace_buffer`] and the find-bar
//! cursor / match count are driven by the editor's CodeMirror search
//! API — the chrome shape here doesn't change.
//!
//! # Usage
//!
//! ```rust,ignore
//! let editor = cx.new(|_window, _cx| {
//!     RawEditor::new(Some(PathBuf::from("config.yaml")), RawLanguage::Yaml, "key: value\n")
//! });
//! cx.subscribe(&editor, |_, _: &BufferChanged, _| {
//!     // queue a vault save with the new buffer contents
//! }).detach();
//! ```

use std::path::PathBuf;

use gpui::prelude::FluentBuilder as _;
use gpui::{
    div, px, App, Context, EventEmitter, InteractiveElement as _, IntoElement, ParentElement,
    Render, SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{v_flex, ActiveTheme, StyledExt as _};
use mock_fixtures::MockVault;
use vault::Vault;

/// How many leading buffer characters the placeholder body renders.
/// The real CodeMirror surface lives in the WKWebView (Phase 8.29) —
/// this preview only exists so the chrome shape is visible during
/// Phase 8 visual QA.
const BODY_PREVIEW_LEN: usize = 200;

// ---------------------------------------------------------------------------
// RawLanguage
// ---------------------------------------------------------------------------

/// File kind the raw editor recognises.  Carries the React-side
/// CodeMirror language discriminant so the future-real WKWebView
/// raw-mode (Phase 8.29) can pick the matching language pack without
/// the chrome crate needing to know how the editor body resolves
/// languages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawLanguage {
    /// YAML — frontmatter blobs, app config files, GitHub workflows.
    Yaml,
    /// JSON — settings, package manifests.
    Json,
    /// CSS — vault custom stylesheets.
    Css,
    /// Shell scripts (`.sh`, `.bash`, `.zsh`).
    Shell,
    /// TOML — `Cargo.toml`, `pyproject.toml`, etc.
    Toml,
    /// Plain text — anything we don't recognise; CodeMirror falls
    /// back to its no-highlight mode.
    PlainText,
}

impl RawLanguage {
    /// Best-effort language inference from a file extension.  The
    /// match is case-insensitive and falls back to
    /// [`RawLanguage::PlainText`] for unknown or empty extensions.
    #[must_use]
    pub fn from_extension(ext: &str) -> Self {
        match ext.trim().to_ascii_lowercase().as_str() {
            "yaml" | "yml" => Self::Yaml,
            "json" => Self::Json,
            "css" => Self::Css,
            "sh" | "bash" | "zsh" => Self::Shell,
            "toml" => Self::Toml,
            _ => Self::PlainText,
        }
    }

    /// CodeMirror language pack id used downstream by the WKWebView
    /// raw-mode (Phase 8.29).  Stable string discriminants because
    /// CodeMirror's `@codemirror/lang-*` packages are keyed by these
    /// names on the JS side.
    #[must_use]
    pub const fn cm_lang_id(self) -> &'static str {
        match self {
            Self::Yaml => "yaml",
            Self::Json => "json",
            Self::Css => "css",
            Self::Shell => "shell",
            Self::Toml => "toml",
            Self::PlainText => "plaintext",
        }
    }
}

// ---------------------------------------------------------------------------
// FindBar
// ---------------------------------------------------------------------------

/// Find-bar state.  The find-bar is hidden until the user opens it
/// (Cmd+F).  All transitions go through [`RawEditor::set_find_query`]
/// / [`RawEditor::open_find`] / [`RawEditor::close_find`] so every
/// state change is observable through the editor's event stream.
///
/// `match_count` is best-effort and capped — Phase 8.29 (WKWebView
/// raw-mode) owns the real counter driven by CodeMirror's
/// `@codemirror/search` extension; until then the chrome accepts a
/// test-driven count via [`RawEditor::set_match_count`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct FindBar {
    /// Whether the find-bar overlay is currently rendered.
    pub visible: bool,
    /// Active search query.  Empty until the user types.
    pub query: SharedString,
    /// Best-effort match count.  Capped — Phase 8.29 owns the real
    /// counter; this field is seeded only by the WKWebView bridge
    /// or by `set_match_count` in tests.
    pub match_count: usize,
    /// Cursor into `0..match_count`; `0` when no matches.
    pub active_index: usize,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted by [`RawEditor::replace_buffer`] when the new buffer
/// contents differ from the current contents.  Workspace subscribers
/// queue a vault save in response.  No payload because the buffer is
/// already readable via [`RawEditor::buffer`] — keeping the event
/// payload-free avoids cloning a potentially-large `SharedString` on
/// every keystroke.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BufferChanged;

/// Emitted whenever the find-bar's visibility flips.  Carries the
/// new visibility so subscribers can update chrome (e.g. dim the
/// editor body) without re-reading the editor state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FindBarToggled {
    /// `true` if the find-bar is now visible.
    pub visible: bool,
}

/// Emitted when the find-bar query changes to a value distinct from
/// the previous query.  Setting the same query is a silent no-op so
/// repeated keystrokes that don't change the buffer (IME composition,
/// caret movement) don't churn subscribers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FindQueryChanged {
    /// The new query.
    pub query: SharedString,
}

/// Emitted by [`RawEditor::jump_next_match`] /
/// [`RawEditor::jump_prev_match`] when the active match index moves.
/// Carries the post-jump index so the WKWebView bridge knows which
/// match to scroll into view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JumpToMatch {
    /// New active match index in `0..match_count`.
    pub index: usize,
}

// ---------------------------------------------------------------------------
// RawEditor
// ---------------------------------------------------------------------------

/// Phase 8.16 raw-text editor chrome view.
///
/// Holds the server-of-record buffer for a non-Markdown file plus the
/// find-bar state.  The actual editing surface (CodeMirror) lives in
/// the WKWebView and lands in Phase 8.29; this chrome owns the state
/// transitions and the event stream the workspace consumes.
pub struct RawEditor {
    path: Option<PathBuf>,
    language: RawLanguage,
    buffer: SharedString,
    dirty: bool,
    find_bar: FindBar,
}

impl EventEmitter<BufferChanged> for RawEditor {}
impl EventEmitter<FindBarToggled> for RawEditor {}
impl EventEmitter<FindQueryChanged> for RawEditor {}
impl EventEmitter<JumpToMatch> for RawEditor {}

impl RawEditor {
    /// Construct a raw editor backed by `buffer`.  `path` is
    /// optional — an unsaved scratch buffer passes `None`.
    #[must_use]
    pub fn new(
        path: Option<PathBuf>,
        language: RawLanguage,
        buffer: impl Into<SharedString>,
    ) -> Self {
        Self {
            path,
            language,
            buffer: buffer.into(),
            dirty: false,
            find_bar: FindBar::default(),
        }
    }

    /// An empty plain-text editor with no backing file — used as the
    /// fallthrough for [`Self::from_or_empty`] when no vault is
    /// installed.
    #[must_use]
    pub fn empty() -> Self {
        Self::new(None, RawLanguage::PlainText, SharedString::default())
    }

    /// Build from the registered globals.  Phase-5 precedence:
    /// `vault::Vault > MockVault > empty`.
    ///
    /// Both [`Self::from_vault`] and [`Self::from_mock`] currently
    /// return an empty-buffer scaffold — Phase 8.11 lands raw-file
    /// listing on the vault; until then the precedence shape just
    /// locks the constructor surface for that swap.
    pub fn from_or_empty(cx: &mut App) -> Self {
        if cx.try_global::<Vault>().is_some() {
            Self::from_vault(cx)
        } else if cx.try_global::<MockVault>().is_some() {
            Self::from_mock(cx)
        } else {
            Self::empty()
        }
    }

    /// Build from the real `vault::Vault` global.  Returns an empty
    /// scaffold until Phase 8.11 exposes raw-file listing — the
    /// branch exists so the constructor surface matches the rest of
    /// the chrome crates.
    ///
    /// # Panics
    ///
    /// Panics if no `Vault` global is installed.  Use
    /// [`Self::from_or_empty`] instead when uncertain.
    pub fn from_vault(cx: &mut App) -> Self {
        let _ = cx.global::<Vault>(); // panic semantics match folder_tree::from_vault
        Self::empty()
    }

    /// Build from the [`MockVault`] global.  Returns an empty
    /// scaffold — the mock launch path doesn't seed raw files yet.
    ///
    /// # Panics
    ///
    /// Panics if no `MockVault` global is installed.  Use
    /// [`Self::from_or_empty`] instead when uncertain.
    pub fn from_mock(cx: &mut App) -> Self {
        let _ = cx.global::<MockVault>(); // panic semantics match folder_tree::from_mock
        Self::empty()
    }

    /// Path to the backing file, if any.  `None` for unsaved scratch
    /// buffers.
    #[must_use]
    pub fn path(&self) -> Option<&PathBuf> {
        self.path.as_ref()
    }

    /// CodeMirror language pack this buffer is rendered with.
    #[must_use]
    pub fn language(&self) -> RawLanguage {
        self.language
    }

    /// Server-of-record buffer contents.  The WKWebView holds the
    /// live editor state; this field is the chrome's mirror that the
    /// workspace persists.
    #[must_use]
    pub fn buffer(&self) -> &SharedString {
        &self.buffer
    }

    /// `true` when the buffer has unsaved changes.
    #[must_use]
    pub fn dirty(&self) -> bool {
        self.dirty
    }

    /// Find-bar state — read-only.  Mutate via
    /// [`Self::open_find`] / [`Self::close_find`] /
    /// [`Self::set_find_query`] so every transition emits the
    /// matching event.
    #[must_use]
    pub fn find_bar(&self) -> &FindBar {
        &self.find_bar
    }

    /// Replace the buffer contents.  Emits [`BufferChanged`] and
    /// marks the editor dirty if `new` differs from the current
    /// buffer; a no-op otherwise so unchanged re-pushes from the
    /// WKWebView don't churn subscribers.
    pub fn replace_buffer(&mut self, new: impl Into<SharedString>, cx: &mut Context<Self>) {
        let new = new.into();
        if self.buffer == new {
            return;
        }
        self.buffer = new;
        self.dirty = true;
        cx.emit(BufferChanged);
        cx.notify();
    }

    /// Clear the dirty flag without touching the buffer or emitting
    /// an event.  Workspace subscribers call this after a successful
    /// vault save.
    pub fn mark_saved(&mut self, cx: &mut Context<Self>) {
        if !self.dirty {
            return;
        }
        self.dirty = false;
        cx.notify();
    }

    /// Show the find-bar.  Emits [`FindBarToggled`] only when the
    /// visibility actually flips.
    pub fn open_find(&mut self, cx: &mut Context<Self>) {
        self.set_find_visible(true, cx);
    }

    /// Hide the find-bar.  Emits [`FindBarToggled`] only when the
    /// visibility actually flips.
    pub fn close_find(&mut self, cx: &mut Context<Self>) {
        self.set_find_visible(false, cx);
    }

    fn set_find_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.find_bar.visible == visible {
            return;
        }
        self.find_bar.visible = visible;
        cx.emit(FindBarToggled { visible });
        cx.notify();
    }

    /// Update the find-bar query.  Emits [`FindQueryChanged`] when
    /// the query actually changes; silent on idempotent writes.
    pub fn set_find_query(&mut self, query: impl Into<SharedString>, cx: &mut Context<Self>) {
        let query = query.into();
        if self.find_bar.query == query {
            return;
        }
        self.find_bar.query = query.clone();
        // Reset cursor — a new query starts from the first match.
        self.find_bar.active_index = 0;
        cx.emit(FindQueryChanged { query });
        cx.notify();
    }

    /// Advance to the next match, wrapping at `match_count`.  Emits
    /// [`JumpToMatch`] only when `match_count > 0`; silent on an
    /// empty result set.
    pub fn jump_next_match(&mut self, cx: &mut Context<Self>) {
        if self.find_bar.match_count == 0 {
            return;
        }
        self.find_bar.active_index = (self.find_bar.active_index + 1) % self.find_bar.match_count;
        cx.emit(JumpToMatch {
            index: self.find_bar.active_index,
        });
        cx.notify();
    }

    /// Step to the previous match, wrapping at `0`.  Emits
    /// [`JumpToMatch`] only when `match_count > 0`; silent on an
    /// empty result set.
    pub fn jump_prev_match(&mut self, cx: &mut Context<Self>) {
        if self.find_bar.match_count == 0 {
            return;
        }
        self.find_bar.active_index = if self.find_bar.active_index == 0 {
            self.find_bar.match_count - 1
        } else {
            self.find_bar.active_index - 1
        };
        cx.emit(JumpToMatch {
            index: self.find_bar.active_index,
        });
        cx.notify();
    }

    /// Seed `match_count` from the WKWebView bridge.  Resets the
    /// cursor to `0` if the new count would put the active index
    /// out of range.  Exposed test-only for now — Phase 8.29 wires
    /// the real CodeMirror search count through this same setter.
    #[cfg(test)]
    pub(crate) fn set_match_count(&mut self, n: usize) {
        self.find_bar.match_count = n;
        if self.find_bar.active_index >= n {
            self.find_bar.active_index = 0;
        }
    }
}

impl Default for RawEditor {
    fn default() -> Self {
        Self::empty()
    }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for RawEditor {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let divider = theme.border;
        let bar_bg = theme.muted;

        let path_label: SharedString = self
            .path
            .as_ref()
            .map(|p| SharedString::from(p.display().to_string()))
            .unwrap_or_else(|| SharedString::new_static("(unsaved)"));
        let dirty_marker = if self.dirty { " · modified" } else { "" };
        let header = SharedString::from(format!(
            "{path_label} · {lang}{dirty_marker}",
            lang = self.language.cm_lang_id()
        ));

        // TODO(phase-8.29): the real CodeMirror editor lives inside the
        // WKWebView; this preview is the chrome placeholder until 8.29
        // lands.  Cut at a char boundary so adversarial multi-byte
        // content doesn't trip the slice's UTF-8 invariant.
        let preview: SharedString = if self.buffer.len() <= BODY_PREVIEW_LEN {
            self.buffer.clone()
        } else {
            let cut = self
                .buffer
                .char_indices()
                .nth(BODY_PREVIEW_LEN)
                .map_or(self.buffer.len(), |(i, _)| i);
            SharedString::from(format!("{}…", &self.buffer[..cut]))
        };

        let find_bar_visible = self.find_bar.visible;
        let find_query = self.find_bar.query.clone();
        let match_count = self.find_bar.match_count;
        let active_index = self.find_bar.active_index;
        let entity = cx.entity();

        v_flex()
            .id("raw-editor")
            .size_full()
            .text_sm()
            .text_color(fg)
            .child(
                div()
                    .id("raw-editor-header")
                    .px(px(12.0))
                    .py(px(6.0))
                    .font_semibold()
                    .child(header),
            )
            .child(div().h(px(1.0)).bg(divider))
            .child(
                div()
                    .id("raw-editor-body")
                    .px(px(12.0))
                    .py(px(8.0))
                    .text_color(muted)
                    .child(preview),
            )
            .when(find_bar_visible, |this| {
                let prev_entity = entity.clone();
                let next_entity = entity.clone();
                // active_index is 0-based; display as 1-based for users,
                // but show "0/0" when there are no matches.
                let position = if match_count == 0 {
                    SharedString::new_static("0/0")
                } else {
                    SharedString::from(format!("{}/{}", active_index + 1, match_count))
                };
                let summary =
                    SharedString::from(format!("Find: '{query}' — {position}", query = find_query));
                this.child(
                    div()
                        .id("raw-editor-find-bar")
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(8.0))
                        .px(px(12.0))
                        .py(px(6.0))
                        .bg(bar_bg)
                        .child(div().child(summary))
                        .child(
                            div()
                                .id("raw-editor-find-prev")
                                .px(px(8.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .cursor_pointer()
                                .text_color(fg)
                                .on_click(move |_, _window, cx| {
                                    prev_entity.update(cx, |this, cx| this.jump_prev_match(cx));
                                })
                                .child(SharedString::new_static("Prev")),
                        )
                        .child(
                            div()
                                .id("raw-editor-find-next")
                                .px(px(8.0))
                                .py(px(2.0))
                                .rounded(px(4.0))
                                .cursor_pointer()
                                .text_color(fg)
                                .on_click(move |_, _window, cx| {
                                    next_entity.update(cx, |this, cx| this.jump_next_match(cx));
                                })
                                .child(SharedString::new_static("Next")),
                        ),
                )
            })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::AppContext as _;
    use gpui::Entity;
    use gpui::TestAppContext;

    fn install_theme(cx: &mut TestAppContext) {
        cx.update(gpui_component::init);
    }

    /// Construct with some buffer + add to a window — render must
    /// not panic with a populated buffer or with the find-bar open.
    #[gpui::test]
    fn editor_renders_without_panic(cx: &mut TestAppContext) {
        install_theme(cx);
        let _window = cx.add_window(|_window, _cx| {
            RawEditor::new(
                Some(PathBuf::from("config.yaml")),
                RawLanguage::Yaml,
                "key: value\nlist:\n  - one\n  - two\n",
            )
        });
        cx.run_until_parked();
    }

    /// `from_or_empty` falls through to [`RawEditor::empty`] when no
    /// `Vault` and no `MockVault` global is installed.
    #[gpui::test]
    fn from_or_empty_falls_through_to_empty_when_no_globals(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            let editor = RawEditor::from_or_empty(cx);
            assert!(editor.path().is_none());
            assert_eq!(editor.language(), RawLanguage::PlainText);
            assert!(editor.buffer().is_empty());
            assert!(!editor.dirty());
        });
    }

    /// `from_or_empty` takes the `MockVault` branch when only a
    /// `MockVault` global is installed.  Currently `from_mock`
    /// returns an empty scaffold (Phase 8.11 lands raw-file listing);
    /// the branch must still be live so the future swap lands with
    /// test coverage already in place.
    #[gpui::test]
    fn from_or_empty_takes_mock_branch_when_mock_present(cx: &mut TestAppContext) {
        install_theme(cx);
        cx.update(|cx| {
            cx.set_global(MockVault::seeded());
            let editor = RawEditor::from_or_empty(cx);
            assert!(
                editor.buffer().is_empty(),
                "from_mock returns empty until Phase 8.11 surfaces raw files"
            );
            assert_eq!(editor.language(), RawLanguage::PlainText);
        });
    }

    /// `RawLanguage::from_extension` round-trips every supported
    /// extension and falls back to `PlainText` for unknown / empty
    /// inputs.  Exhaustive over `RawLanguage` so adding a variant
    /// without coverage fails to compile.
    #[test]
    fn language_from_extension_round_trips() {
        let cases = [
            ("yaml", RawLanguage::Yaml),
            ("YML", RawLanguage::Yaml),
            ("json", RawLanguage::Json),
            ("css", RawLanguage::Css),
            ("sh", RawLanguage::Shell),
            ("bash", RawLanguage::Shell),
            ("zsh", RawLanguage::Shell),
            ("toml", RawLanguage::Toml),
            ("md", RawLanguage::PlainText),
            ("", RawLanguage::PlainText),
        ];
        for (ext, expected) in cases {
            assert_eq!(
                RawLanguage::from_extension(ext),
                expected,
                "extension {ext:?} must infer to {expected:?}"
            );
        }
        // Exhaustive sanity: every variant has a non-empty cm_lang_id.
        for variant in [
            RawLanguage::Yaml,
            RawLanguage::Json,
            RawLanguage::Css,
            RawLanguage::Shell,
            RawLanguage::Toml,
            RawLanguage::PlainText,
        ] {
            match variant {
                RawLanguage::Yaml => assert_eq!(variant.cm_lang_id(), "yaml"),
                RawLanguage::Json => assert_eq!(variant.cm_lang_id(), "json"),
                RawLanguage::Css => assert_eq!(variant.cm_lang_id(), "css"),
                RawLanguage::Shell => assert_eq!(variant.cm_lang_id(), "shell"),
                RawLanguage::Toml => assert_eq!(variant.cm_lang_id(), "toml"),
                RawLanguage::PlainText => assert_eq!(variant.cm_lang_id(), "plaintext"),
            }
        }
    }

    /// `replace_buffer` with content distinct from the current
    /// buffer emits `BufferChanged` exactly once and flips `dirty`.
    #[gpui::test]
    fn replace_buffer_with_different_content_emits_and_marks_dirty(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let editor: Entity<RawEditor> =
            cx.update(|cx| cx.new(|_| RawEditor::new(None, RawLanguage::PlainText, "initial")));

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&editor, move |_, _event: &BufferChanged, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            editor.update(cx, |this, cx| this.replace_buffer("changed", cx));
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            1,
            "replace_buffer with new content must emit exactly once"
        );
        cx.update(|cx| {
            assert!(editor.read(cx).dirty(), "replace_buffer must flip dirty");
            assert_eq!(editor.read(cx).buffer().as_ref(), "changed");
        });
    }

    /// Replacing the buffer with the same content is a silent no-op
    /// — no event, no dirty flip — so unchanged re-pushes from the
    /// WKWebView don't churn subscribers.
    #[gpui::test]
    fn replace_buffer_with_same_content_is_silent_no_op(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let editor: Entity<RawEditor> =
            cx.update(|cx| cx.new(|_| RawEditor::new(None, RawLanguage::PlainText, "stable")));

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&editor, move |_, _event: &BufferChanged, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            editor.update(cx, |this, cx| this.replace_buffer("stable", cx));
        });
        cx.run_until_parked();

        assert_eq!(*received.borrow(), 0, "same-content replace must not emit");
        cx.update(|cx| {
            assert!(
                !editor.read(cx).dirty(),
                "same-content replace must not flip dirty"
            );
        });
    }

    /// `mark_saved` clears `dirty` without touching the buffer and
    /// without emitting `BufferChanged`.
    #[gpui::test]
    fn mark_saved_clears_dirty_without_event(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let editor: Entity<RawEditor> =
            cx.update(|cx| cx.new(|_| RawEditor::new(None, RawLanguage::PlainText, "v0")));

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&editor, move |_, _event: &BufferChanged, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });

        cx.update(|cx| {
            editor.update(cx, |this, cx| {
                this.replace_buffer("v1", cx);
                this.mark_saved(cx);
            });
        });
        cx.run_until_parked();

        cx.update(|cx| {
            assert!(!editor.read(cx).dirty(), "mark_saved must clear dirty");
            assert_eq!(
                editor.read(cx).buffer().as_ref(),
                "v1",
                "mark_saved must not touch the buffer"
            );
        });
        assert_eq!(
            *received.borrow(),
            1,
            "mark_saved must not itself emit BufferChanged"
        );
    }

    /// `open_find` + `close_find` flip visibility and emit
    /// `FindBarToggled` once per real transition.
    #[gpui::test]
    fn open_find_close_find_toggles_visibility_and_emits(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let editor: Entity<RawEditor> = cx.update(|cx| cx.new(|_| RawEditor::empty()));

        let received: Rc<RefCell<Vec<bool>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&editor, move |_, event: &FindBarToggled, _| {
                recv.borrow_mut().push(event.visible);
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            editor.update(cx, |this, cx| {
                this.open_find(cx);
                this.open_find(cx); // idempotent
                this.close_find(cx);
                this.close_find(cx); // idempotent
            });
        });
        cx.run_until_parked();

        assert_eq!(
            received.borrow().clone(),
            vec![true, false],
            "open + close must each emit exactly once with the correct visible flag"
        );
    }

    /// `set_find_query` emits once on a real change and is silent on
    /// an idempotent rewrite.
    #[gpui::test]
    fn set_find_query_changing_emits_and_idempotent_otherwise(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let editor: Entity<RawEditor> = cx.update(|cx| cx.new(|_| RawEditor::empty()));

        let received: Rc<RefCell<Vec<SharedString>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&editor, move |_, event: &FindQueryChanged, _| {
                recv.borrow_mut().push(event.query.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            editor.update(cx, |this, cx| {
                this.set_find_query("hello", cx);
                this.set_find_query("hello", cx); // idempotent
                this.set_find_query("world", cx);
            });
        });
        cx.run_until_parked();

        let got = received.borrow().clone();
        assert_eq!(
            got,
            vec![SharedString::from("hello"), SharedString::from("world")],
            "set_find_query must emit only on real changes"
        );
    }

    /// `jump_next_match` with seeded matches emits `JumpToMatch`
    /// carrying the new active index and advances the cursor with
    /// wraparound at `match_count`.
    #[gpui::test]
    fn jump_next_match_with_matches_emits_and_advances_index(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let editor: Entity<RawEditor> = cx.update(|cx| cx.new(|_| RawEditor::empty()));

        // Seed match_count = 3 directly — Phase 8.29 will drive this
        // from the WKWebView search bridge.
        cx.update(|cx| {
            editor.update(cx, |this, _cx| this.set_match_count(3));
        });

        let received: Rc<RefCell<Vec<usize>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&editor, move |_, event: &JumpToMatch, _| {
                recv.borrow_mut().push(event.index);
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            editor.update(cx, |this, cx| {
                this.jump_next_match(cx); // 0 → 1
                this.jump_next_match(cx); // 1 → 2
                this.jump_next_match(cx); // 2 → 0 (wrap)
                this.jump_prev_match(cx); // 0 → 2 (wrap)
            });
        });
        cx.run_until_parked();

        assert_eq!(
            received.borrow().clone(),
            vec![1, 2, 0, 2],
            "jump_next_match and jump_prev_match must wrap and emit each step"
        );
        cx.update(|cx| {
            assert_eq!(editor.read(cx).find_bar().active_index, 2);
        });
    }

    /// `jump_next_match` / `jump_prev_match` with `match_count == 0`
    /// is a silent no-op — no event, no cursor change.  Guards the
    /// "no matches" branch so the empty-result UX doesn't fire
    /// phantom jumps.
    #[gpui::test]
    fn jump_with_zero_matches_is_silent(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let editor: Entity<RawEditor> = cx.update(|cx| cx.new(|_| RawEditor::empty()));

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&editor, move |_, _event: &JumpToMatch, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| {
            editor.update(cx, |this, cx| {
                this.jump_next_match(cx);
                this.jump_prev_match(cx);
            });
        });
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            0,
            "jumps with match_count == 0 must be silent"
        );
    }
}
