//! Per-note toolbar row (ADR-0115 Phase 7, visual-issue #019).
//!
//! Mirrors `src/components/BreadcrumbBar.tsx` from the React tree — a
//! `NOTE_TOOLBAR_HEIGHT_PT`-tall strip pinned above the embedded
//! WKWebView with two clusters:
//!
//! - **Left** — breadcrumb (type label · `›` · filename stem · sync
//!   glyph).
//! - **Right** — 11 action cells matching React's `BreadcrumbActions`
//!   order: favourite, organised, neighbourhood, raw mode, note width,
//!   AI, table of contents, reveal in Finder, copy path, more, toggle
//!   inspector.
//!
//! Height is pinned to `NOTE_TOOLBAR_HEIGHT_PT` (52 pt) so the strip
//! aligns row-for-row with the `note_list_pane` header to its left.
//!
//! Every cell is a log-only stub today; wiring to real actions lands
//! alongside the Phase 8 modal-chrome work (the React `onToggle*`
//! callbacks need their GPUI counterparts first).  Cells are
//! `id()`-tagged + `dump_as`-registered so periscope can target them
//! by name once the actions land.

use std::path::Path;

use gpui::{
    div, px, AnyElement, App, ClipboardItem, InteractiveElement, IntoElement, ParentElement,
    SharedString, StatefulInteractiveElement as _, Styled, Window,
};
use gpui_component::{h_flex, tooltip::Tooltip, ActiveTheme, IconName};
use ui::tree_dump::DumpAsExt as _;

/// Height of the note toolbar strip, in logical points.
///
/// Pinned to React's `.breadcrumb-bar { height: 52px }`
/// (`src/components/BreadcrumbBar.tsx:1061`) and matched to the
/// `note_list_pane` header strip (`crates/note_list_pane/src/lib.rs`)
/// so the two land on the same baseline.
pub const NOTE_TOOLBAR_HEIGHT_PT: f32 = 52.0;

/// Render the toolbar row for a single note.
///
/// `path` is the on-disk path; the breadcrumb extracts the type label
/// from its filename prefix and uses the file stem as the trailing
/// segment.
pub(crate) fn render(path: &Path, cx: &App) -> AnyElement {
    let theme = cx.theme();
    let bg = theme.background;
    let border = theme.border;
    let fg = theme.foreground;
    let muted = theme.muted_foreground;

    let stem: SharedString = path
        .file_stem()
        .and_then(|s| s.to_str())
        .map(SharedString::from)
        .unwrap_or_default();
    let type_label = SharedString::new_static(type_label_singular(path));

    let breadcrumb = h_flex()
        .items_center()
        .gap(px(6.0))
        .text_sm()
        .text_color(muted)
        .child(
            div()
                .id("note-toolbar-type")
                .child(type_label)
                .tooltip(|window, cx| Tooltip::new("Note type — click to change").build(window, cx))
                .dump_as("note-toolbar-type"),
        )
        .child(div().text_color(muted).child(IconName::ChevronRight))
        .child(
            div()
                .text_color(fg)
                .child(stem.clone())
                .dump_as("note-toolbar-filename"),
        )
        .child(
            div()
                .id("note-toolbar-sync")
                .cursor_pointer()
                .text_color(muted)
                .hover(|this| this.text_color(fg))
                // React's `BreadcrumbBar` uses Phosphor `ArrowsClockwise` for the
                // sync glyph.  gpui-component's pack has no clockwise icon;
                // `Redo` (Lucide's curving arrow) is the closest visual match
                // — single curved stroke matching the React reference rather
                // than the two-straight-arrows shape of `IconName::Replace`.
                .child(IconName::Undo)
                .tooltip(|window, cx| Tooltip::new("Sync status").build(window, cx))
                .dump_as("note-toolbar-sync")
                .into_any_element(),
        );

    // Action cluster — mirrors `BreadcrumbActions` (BreadcrumbBar.tsx
    // L811-890) left-to-right, plus the trailing inspector toggle
    // (L987-994).  Unwired cells (worklist 2.9-2.14, 2.17) keep a
    // log-only stub; reveal / copy-path / inspector (2.15 / 2.16 /
    // 2.18) dispatch real handlers.
    let reveal_path = path.to_path_buf();
    let copy_path = path.to_path_buf();
    let actions = h_flex()
        .items_center()
        .gap(px(4.0))
        .text_color(muted)
        .child(stub_cell(
            "note-toolbar-star",
            IconName::Star,
            "Star this note",
        ))
        .child(stub_cell(
            "note-toolbar-organized",
            IconName::CircleCheck,
            "Show in Organized view",
        ))
        .child(stub_cell(
            "note-toolbar-neighborhood",
            IconName::Map,
            "Show neighborhood graph",
        ))
        .child(stub_cell(
            "note-toolbar-raw",
            IconName::SquareTerminal,
            "Toggle raw markdown",
        ))
        .child(stub_cell(
            "note-toolbar-width",
            IconName::Maximize,
            "Toggle note width",
        ))
        .child(stub_cell(
            "note-toolbar-ai",
            IconName::Asterisk,
            "Open AI assistant",
        ))
        .child(stub_cell(
            "note-toolbar-toc",
            IconName::Menu,
            "Table of contents",
        ))
        .child(toolbar_cell(
            "note-toolbar-reveal",
            IconName::FolderOpen,
            "Reveal in Finder",
            move |_window, _cx| reveal_in_finder(&reveal_path),
        ))
        .child(toolbar_cell(
            "note-toolbar-copy-path",
            IconName::Copy,
            "Copy note path",
            move |_window, cx| copy_path_to_clipboard(&copy_path, cx),
        ))
        .child(stub_cell(
            "note-toolbar-more",
            IconName::Ellipsis,
            "More actions",
        ))
        .child(toolbar_cell(
            "note-toolbar-inspector",
            IconName::PanelRight,
            "Toggle inspector",
            |_window, cx| {
                cx.dispatch_action(&actions::ToggleInspector);
                log::info!(
                    target: "note_item::toolbar",
                    "inspector: dispatched ToggleInspector"
                );
            },
        ));

    h_flex()
        .h(px(NOTE_TOOLBAR_HEIGHT_PT))
        .min_h(px(NOTE_TOOLBAR_HEIGHT_PT))
        .items_center()
        .justify_between()
        .px(px(16.0))
        .bg(bg)
        .border_b_1()
        .border_color(border)
        .child(breadcrumb)
        .child(actions)
        .dump_as("note-toolbar")
        .into_any_element()
}

/// One toolbar action cell — square click target with a single
/// [`IconName`] glyph centred inside.  `tooltip` is the verb-noun
/// label shown on hover (worklist 2.4); `on_click` is invoked when
/// the cell is clicked.
///
/// Single source of truth for the cell's visual chain (size, hover
/// background, `dump_as`, `tooltip`) — see [`stub_cell`] for the
/// log-only default used by the seven still-unwired cells.
fn toolbar_cell(
    id: &'static str,
    icon: IconName,
    tooltip: &'static str,
    on_click: impl Fn(&mut Window, &mut App) + 'static,
) -> AnyElement {
    div()
        .id(id)
        .flex()
        .items_center()
        .justify_center()
        .h(px(24.0))
        .w(px(24.0))
        .rounded_sm()
        .cursor_pointer()
        .hover(|this| this.bg(gpui::hsla(0.0, 0.0, 0.5, 0.12)))
        .on_click(move |_, window, cx| on_click(window, cx))
        .tooltip(move |window, cx| Tooltip::new(tooltip).build(window, cx))
        .child(icon)
        .dump_as(id)
        .into_any_element()
}

/// Convenience wrapper around [`toolbar_cell`] for cells whose
/// behaviour hasn't been wired yet — logs the stub message on click,
/// matching the previous helper's body.  Used by the seven worklist
/// rows (2.9-2.14, 2.17) that need real product work (frontmatter
/// mutation, new panels, AI integration) before they can dispatch.
fn stub_cell(id: &'static str, icon: IconName, tooltip: &'static str) -> AnyElement {
    toolbar_cell(id, icon, tooltip, move |_, _| {
        log::info!("note toolbar action stub: {id}");
    })
}

/// Reveal-in-Finder handler for the `note-toolbar-reveal` cell
/// (worklist 2.15).  Spawns `open -R <path>` so Finder selects the
/// note in its containing folder — `open -R` is the macOS-idiomatic
/// "select" verb, distinct from `open <path>` which would open the
/// note in its default application.  We discard the [`Child`] handle
/// rather than waiting on it; Finder owns user feedback from here.
///
/// [`Child`]: std::process::Child
fn reveal_in_finder(path: &Path) {
    let path_str = path.to_string_lossy();
    #[cfg(target_os = "macos")]
    {
        match std::process::Command::new("open")
            .args(["-R", path_str.as_ref()])
            .spawn()
        {
            Ok(_) => log::info!(
                target: "note_item::toolbar",
                "reveal: spawned open -R {path_str}"
            ),
            Err(e) => log::warn!(
                target: "note_item::toolbar",
                "reveal: open -R failed: {e:#}"
            ),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        log::warn!(
            target: "note_item::toolbar",
            "reveal: select-in-file-manager not yet implemented on this platform ({path_str})"
        );
    }
}

/// Copy-path handler for the `note-toolbar-copy-path` cell (worklist
/// 2.16).  Writes the note's absolute path to the system clipboard
/// via [`App::write_to_clipboard`] — no toast required because the
/// user confirms the copy by pasting elsewhere.
fn copy_path_to_clipboard(path: &Path, cx: &App) {
    let path_str = path.to_string_lossy().into_owned();
    log::info!(target: "note_item::toolbar", "copy-path: copied {path_str}");
    cx.write_to_clipboard(ClipboardItem::new_string(path_str));
}

/// Singular type label for the breadcrumb (`procedure-foo.md` →
/// `"Procedure"`).
///
/// Sibling to `sidebar_panel::type_label_for`, which returns the
/// *plural* form used as a sidebar section header.  Duplicated here
/// rather than pulled across crates because the heuristic is two
/// lines and the singular/plural variants tend to drift independently
/// (e.g. "Person" vs. "People").
fn type_label_singular(path: &Path) -> &'static str {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or_default();
    let prefix = stem
        .split_once('-')
        .map(|(p, _)| p)
        .unwrap_or(stem)
        .to_ascii_lowercase();
    match prefix.as_str() {
        "area" => "Area",
        "event" => "Event",
        "measure" => "Measure",
        "person" => "Person",
        "procedure" => "Procedure",
        "responsibility" => "Responsibility",
        "topic" => "Topic",
        "project" => "Project",
        "quarter" => "Quarter",
        _ => "Note",
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn type_label_singular_extracts_known_prefixes() {
        let cases: &[(&str, &str)] = &[
            ("procedure-quarterly-sponsor-outreach.md", "Procedure"),
            ("area-building.md", "Area"),
            ("event-team-sync.md", "Event"),
            ("measure-revenue.md", "Measure"),
            ("person-alice.md", "Person"),
            ("responsibility-sponsorships.md", "Responsibility"),
            ("topic-product.md", "Topic"),
            ("project-tolaria.md", "Project"),
            ("quarter-2026q1.md", "Quarter"),
            ("untitled.md", "Note"),
            ("readme.md", "Note"),
        ];
        for (input, expected) in cases {
            let label = type_label_singular(&PathBuf::from(input));
            assert_eq!(label, *expected, "input={input}");
        }
    }

    #[test]
    fn toolbar_cell_builds_reveal_button() {
        // Worklist 2.15 — the reveal cell must construct successfully
        // with a non-stub handler.  Click behaviour goes through `open
        // -R`, which we can't drive headlessly, so we only assert the
        // builder returns an element.
        let _cell = toolbar_cell(
            "note-toolbar-reveal",
            IconName::FolderOpen,
            "Reveal in Finder",
            |_window, _cx| {},
        );
    }

    #[test]
    fn toolbar_cell_builds_copy_path_button() {
        // Worklist 2.16 — same shape assertion as the reveal cell.
        // The clipboard write needs a live `App`, so the handler body
        // here is a no-op; the wired call site in `render` passes the
        // real `copy_path_to_clipboard` invocation.
        let _cell = toolbar_cell(
            "note-toolbar-copy-path",
            IconName::Copy,
            "Copy note path",
            |_window, _cx| {},
        );
    }

    #[test]
    fn toolbar_cell_builds_inspector_button() {
        // Worklist 2.18 — same shape assertion as the other wired
        // cells.  The real handler dispatches `actions::ToggleInspector`
        // via `cx.dispatch_action`, which requires a live `App`.
        let _cell = toolbar_cell(
            "note-toolbar-inspector",
            IconName::PanelRight,
            "Toggle inspector",
            |_window, _cx| {},
        );
    }

    #[test]
    fn toolbar_height_matches_react_breadcrumb_bar() {
        // React: `.breadcrumb-bar { height: 52px }` (BreadcrumbBar.tsx:1061).
        // 52.0 is exactly representable in f32 — direct equality is sound.
        assert_eq!(NOTE_TOOLBAR_HEIGHT_PT, 52.0);
    }
}
