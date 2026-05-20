#![forbid(unsafe_code)]
//! Non-editor rendering surfaces (ADR-0115 Phase 8.21, Strand B).
//!
//! Mirrors the Tauri-era read-only rendering primitives used *outside*
//! the editor body:
//!
//! - `src/components/MarkdownContent.tsx` — read-only markdown render
//!   (AI panel responses, inspector previews, banners).
//! - `src/components/SafeMarkup.tsx` — sanitized HTML-ish renderer for
//!   trusted snippets.
//! - `src/components/MermaidDiagram.tsx` — Mermaid diagram block.
//! - `src/components/TldrawWhiteboard.tsx` — tldraw whiteboard surface.
//! - `src/components/FilePreview.tsx` — file preview (image / PDF /
//!   generic).
//!
//! The editor body itself lives in the WKWebView (Strand C) so this
//! crate scaffolds *only* the chrome-side read-only surfaces.  For
//! Phase 8 each variant renders a simple placeholder showing the
//! content type + payload summary.  The real rendering pipelines
//! (pulldown_cmark, mermaid via WebView round-trip, tldraw via
//! WebView round-trip, image decode via the `image` crate) land in
//! follow-up phases — flagged with `TODO(rendering-pipeline)`.
//!
//! # Usage
//!
//! ```rust,ignore
//! let view = cx.new(|_window, _cx| {
//!     RenderingPrimitive::new(RenderingSurface::Markdown {
//!         source: "# hello".into(),
//!     })
//! });
//! cx.subscribe(&view, |_, e: &PreviewActivated, _| {
//!     // Open the file / expand the diagram.
//! }).detach();
//! ```

use std::path::PathBuf;

use gpui::prelude::FluentBuilder as _;
use gpui::{
    div, px, Context, EventEmitter, InteractiveElement as _, IntoElement, ParentElement, Render,
    SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{v_flex, ActiveTheme, StyledExt as _};

// ---------------------------------------------------------------------------
// RenderingSurface
// ---------------------------------------------------------------------------

/// One of the non-editor rendering surfaces.  Each variant carries
/// the minimal payload needed to identify what should be drawn; the
/// concrete pipeline that turns the payload into pixels lands in a
/// follow-up phase (see `TODO(rendering-pipeline)` in [`Render`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenderingSurface {
    /// Read-only markdown body (AI responses, inspector previews,
    /// banner copy).
    Markdown {
        /// Raw markdown source.
        source: SharedString,
    },
    /// Sanitized HTML-ish snippet from a trusted source.
    SafeMarkup {
        /// Pre-sanitized HTML fragment.
        html: SharedString,
    },
    /// A Mermaid diagram block — `source` is the Mermaid DSL.
    Mermaid {
        /// Mermaid diagram source text.
        source: SharedString,
    },
    /// A tldraw whiteboard surface referenced by snapshot id.
    Whiteboard {
        /// Stable id of the tldraw snapshot to mount.
        snapshot_id: SharedString,
    },
    /// File preview — image, PDF, or generic fallback.
    FilePreview {
        /// Absolute filesystem path of the file to preview.
        path: PathBuf,
        /// Preview kind — chosen by the caller from the file's extension
        /// / mime type so this crate stays free of probing logic.
        kind: FilePreviewKind,
    },
}

/// The kind of file preview to render.  Chosen by the caller from the
/// file's extension or mime type so this crate doesn't depend on a
/// mime detector.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilePreviewKind {
    /// Raster / vector image — decoded via the `image` crate later.
    Image,
    /// PDF document — rendered via WKWebView round-trip later.
    Pdf,
    /// Anything else — renders a file-name + size placeholder.
    Generic,
}

impl RenderingSurface {
    /// Pure discriminant label — used for the rendered header and for
    /// debugging.  Round-trip tested via `surface_label_round_trips`.
    #[must_use]
    pub const fn label(&self) -> &'static str {
        match self {
            Self::Markdown { .. } => "Markdown",
            Self::SafeMarkup { .. } => "SafeMarkup",
            Self::Mermaid { .. } => "Mermaid",
            Self::Whiteboard { .. } => "Whiteboard",
            Self::FilePreview { .. } => "FilePreview",
        }
    }

    /// Stable element id for the surface's outer container.  Exposed
    /// so periscope can target each variant by name without depending
    /// on payload contents.
    #[must_use]
    pub const fn element_id(&self) -> &'static str {
        match self {
            Self::Markdown { .. } => "rendering-markdown",
            Self::SafeMarkup { .. } => "rendering-safemarkup",
            Self::Mermaid { .. } => "rendering-mermaid",
            Self::Whiteboard { .. } => "rendering-whiteboard",
            Self::FilePreview { .. } => "rendering-file-preview",
        }
    }

    /// `true` when clicking the surface should emit [`PreviewActivated`].
    /// Markdown / SafeMarkup / Mermaid are read-only and silent;
    /// Whiteboard / FilePreview are interactive (open / expand).
    #[must_use]
    pub const fn is_interactive(&self) -> bool {
        matches!(self, Self::Whiteboard { .. } | Self::FilePreview { .. })
    }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when the user clicks an interactive surface
/// ([`RenderingSurface::Whiteboard`] / [`RenderingSurface::FilePreview`]).
/// Workspace subscribers map the event to "open in native handler" /
/// "expand diagram" / similar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreviewActivated {
    /// For [`RenderingSurface::FilePreview`] the absolute path as a
    /// string; for [`RenderingSurface::Whiteboard`] the snapshot id.
    pub path_or_id: SharedString,
}

// ---------------------------------------------------------------------------
// RenderingPrimitive
// ---------------------------------------------------------------------------

/// Phase 8.21 read-only rendering view.  Holds one active
/// [`RenderingSurface`] and emits [`PreviewActivated`] when the user
/// clicks an interactive surface.
pub struct RenderingPrimitive {
    surface: RenderingSurface,
}

impl EventEmitter<PreviewActivated> for RenderingPrimitive {}

impl RenderingPrimitive {
    /// Construct a view that displays `surface`.
    #[must_use]
    pub fn new(surface: RenderingSurface) -> Self {
        Self { surface }
    }

    /// Replace the active surface.  Notifies observers when the
    /// variant differs from the current one; setting a different
    /// payload of the *same* variant also notifies so subscribers
    /// re-read updated source text / file paths.  Setting an
    /// identical surface is a silent no-op.
    pub fn set_surface(&mut self, surface: RenderingSurface, cx: &mut Context<Self>) {
        if self.surface == surface {
            return;
        }
        self.surface = surface;
        cx.notify();
    }

    /// The surface currently shown.
    #[must_use]
    pub fn surface(&self) -> &RenderingSurface {
        &self.surface
    }

    /// Pure label for the active surface — convenience accessor used
    /// by tests and the rendered header.
    #[must_use]
    pub fn surface_label(&self) -> &'static str {
        self.surface.label()
    }

    /// Stable periscope id for the active surface's outer container.
    #[must_use]
    pub fn element_id(&self) -> &'static str {
        self.surface.element_id()
    }

    /// Emit [`PreviewActivated`] with the surface's path-or-id payload.
    /// No-op for non-interactive surfaces so callers can wire the same
    /// click handler unconditionally.
    pub fn activate(&mut self, cx: &mut Context<Self>) {
        let Some(payload) = self.activation_payload() else {
            return;
        };
        cx.emit(PreviewActivated {
            path_or_id: payload,
        });
    }

    /// Path-or-id payload for the active surface, when it has one.
    fn activation_payload(&self) -> Option<SharedString> {
        match &self.surface {
            RenderingSurface::Whiteboard { snapshot_id } => Some(snapshot_id.clone()),
            RenderingSurface::FilePreview { path, .. } => {
                Some(SharedString::from(path.display().to_string()))
            }
            _ => None,
        }
    }

    /// Body-summary text rendered under the header.  Truncated so a
    /// pathological payload doesn't blow up the layout.
    fn body_summary(&self) -> SharedString {
        const MAX: usize = 120;
        match &self.surface {
            RenderingSurface::Markdown { source } | RenderingSurface::Mermaid { source } => {
                truncate(source.as_ref(), MAX)
            }
            RenderingSurface::SafeMarkup { html } => truncate(html.as_ref(), MAX),
            RenderingSurface::Whiteboard { snapshot_id } => snapshot_id.clone(),
            RenderingSurface::FilePreview { path, kind } => SharedString::from(format!(
                "{kind:?}: {}",
                path.file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.display().to_string())
            )),
        }
    }
}

fn truncate(s: &str, max: usize) -> SharedString {
    if s.len() <= max {
        return SharedString::from(s.to_owned());
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    SharedString::from(format!("{}…", &s[..end]))
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

impl Render for RenderingPrimitive {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // TODO(rendering-pipeline): replace the placeholder body with
        // the real pipeline per variant (pulldown_cmark for Markdown,
        // sanitized HTML element tree for SafeMarkup, WebView round-trip
        // for Mermaid + Whiteboard, image decode via the `image` crate
        // for FilePreview::Image, WebView round-trip for ::Pdf).
        let theme = cx.theme();
        let fg = theme.foreground;
        let muted = theme.muted_foreground;
        let entity = cx.entity();

        let header = SharedString::new_static(self.surface.label());
        let body = self.body_summary();
        let id = self.surface.element_id();
        let interactive = self.surface.is_interactive();

        v_flex()
            .id(id)
            .p(px(12.0))
            .gap(px(6.0))
            .text_sm()
            .text_color(fg)
            .child(div().font_semibold().child(header))
            .child(
                div()
                    .id("rendering-body")
                    .text_color(muted)
                    .child(body)
                    .when(interactive, move |this| {
                        this.cursor_pointer().on_click(move |_, _window, cx| {
                            entity.update(cx, |this, cx| this.activate(cx));
                        })
                    }),
            )
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

    fn every_surface() -> Vec<RenderingSurface> {
        vec![
            RenderingSurface::Markdown {
                source: "# hello".into(),
            },
            RenderingSurface::SafeMarkup {
                html: "<p>safe</p>".into(),
            },
            RenderingSurface::Mermaid {
                source: "graph TD; A-->B;".into(),
            },
            RenderingSurface::Whiteboard {
                snapshot_id: "snap-42".into(),
            },
            RenderingSurface::FilePreview {
                path: PathBuf::from("/tmp/example.png"),
                kind: FilePreviewKind::Image,
            },
        ]
    }

    /// Every surface variant must render without panic.
    #[gpui::test]
    fn every_surface_renders_without_panic(cx: &mut TestAppContext) {
        install_theme(cx);
        for surface in every_surface() {
            let _window =
                cx.add_window(move |_window, _cx| RenderingPrimitive::new(surface.clone()));
            cx.run_until_parked();
        }
    }

    /// `set_surface` to an identical surface is a silent no-op;
    /// switching to a different variant notifies observers.
    #[gpui::test]
    fn set_surface_to_different_variant_notifies(cx: &mut TestAppContext) {
        install_theme(cx);
        let view: Entity<RenderingPrimitive> = cx.update(|cx| {
            cx.new(|_| RenderingPrimitive::new(RenderingSurface::Markdown { source: "a".into() }))
        });

        cx.update(|cx| {
            view.update(cx, |this, cx| {
                this.set_surface(RenderingSurface::Markdown { source: "a".into() }, cx); // identical → no-op
                this.set_surface(
                    RenderingSurface::Mermaid {
                        source: "graph TD; A-->B;".into(),
                    },
                    cx,
                ); // different variant → notify
            });
        });

        cx.update(|cx| {
            assert_eq!(view.read(cx).surface_label(), "Mermaid");
        });
    }

    /// Clicking a `FilePreview` surface emits `PreviewActivated`
    /// carrying the file path.
    #[gpui::test]
    fn file_preview_click_emits_preview_activated(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let view: Entity<RenderingPrimitive> = cx.update(|cx| {
            cx.new(|_| {
                RenderingPrimitive::new(RenderingSurface::FilePreview {
                    path: PathBuf::from("/tmp/example.png"),
                    kind: FilePreviewKind::Image,
                })
            })
        });

        let received: Rc<RefCell<Vec<PreviewActivated>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_, event: &PreviewActivated, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| view.update(cx, |this, cx| this.activate(cx)));
        cx.run_until_parked();

        let got = received.borrow();
        assert_eq!(got.len(), 1, "activate must emit exactly one event");
        assert_eq!(got[0].path_or_id.as_ref(), "/tmp/example.png");
    }

    /// Clicking a `Whiteboard` surface emits `PreviewActivated`
    /// carrying the snapshot id.
    #[gpui::test]
    fn whiteboard_click_emits_preview_activated_with_snapshot_id(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let view: Entity<RenderingPrimitive> = cx.update(|cx| {
            cx.new(|_| {
                RenderingPrimitive::new(RenderingSurface::Whiteboard {
                    snapshot_id: "snap-42".into(),
                })
            })
        });

        let received: Rc<RefCell<Vec<PreviewActivated>>> = Rc::new(RefCell::new(Vec::new()));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_, event: &PreviewActivated, _| {
                recv.borrow_mut().push(event.clone());
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| view.update(cx, |this, cx| this.activate(cx)));
        cx.run_until_parked();

        let got = received.borrow();
        assert_eq!(got.len(), 1, "activate must emit exactly one event");
        assert_eq!(got[0].path_or_id.as_ref(), "snap-42");
    }

    /// `activate` on a non-interactive surface (Markdown / SafeMarkup
    /// / Mermaid) must NOT emit `PreviewActivated`.
    #[gpui::test]
    fn non_interactive_surfaces_do_not_emit(cx: &mut TestAppContext) {
        use std::cell::RefCell;
        use std::rc::Rc;

        install_theme(cx);
        let view: Entity<RenderingPrimitive> = cx.update(|cx| {
            cx.new(|_| {
                RenderingPrimitive::new(RenderingSurface::Markdown {
                    source: "hi".into(),
                })
            })
        });

        let received: Rc<RefCell<u32>> = Rc::new(RefCell::new(0));
        cx.update(|cx| {
            let recv = received.clone();
            cx.subscribe(&view, move |_, _event: &PreviewActivated, _| {
                *recv.borrow_mut() += 1;
            })
            .detach();
        });
        cx.run_until_parked();

        cx.update(|cx| view.update(cx, |this, cx| this.activate(cx)));
        cx.run_until_parked();

        assert_eq!(
            *received.borrow(),
            0,
            "non-interactive surfaces must not emit PreviewActivated"
        );
    }

    /// Every surface's `element_id` is unique so periscope can target
    /// each variant by name without collision.
    #[test]
    fn element_ids_are_unique_across_variants() {
        let ids: Vec<&'static str> = every_surface().iter().map(|s| s.element_id()).collect();
        let mut seen = std::collections::HashSet::new();
        for id in &ids {
            assert!(seen.insert(*id), "duplicate element id: {id}");
        }
        assert_eq!(seen.len(), 5, "expected one element id per surface");
    }

    /// `surface_label` is a pure projection of the discriminant.
    #[test]
    fn surface_label_round_trips() {
        let cases = [
            (RenderingSurface::Markdown { source: "".into() }, "Markdown"),
            (
                RenderingSurface::SafeMarkup { html: "".into() },
                "SafeMarkup",
            ),
            (RenderingSurface::Mermaid { source: "".into() }, "Mermaid"),
            (
                RenderingSurface::Whiteboard {
                    snapshot_id: "".into(),
                },
                "Whiteboard",
            ),
            (
                RenderingSurface::FilePreview {
                    path: PathBuf::new(),
                    kind: FilePreviewKind::Generic,
                },
                "FilePreview",
            ),
        ];
        for (surface, expected) in cases {
            assert_eq!(surface.label(), expected);
        }
    }
}
