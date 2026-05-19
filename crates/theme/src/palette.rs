//! Tolaria-branded colour palette, derived from `src/index.css`.
//!
//! `src/index.css` is the authoritative theme contract for the
//! Tauri-era app; the Rust shell must reproduce those exact values so
//! the native chrome lines up pixel-for-pixel with the reference
//! screenshots [`tolaria-demo-vault-v2-light.png`] /
//! [`tolaria-demo-vault-v2-dark.png`].  The mapping below preserves
//! the shadcn aliases (`background`, `foreground`, `sidebar`,
//! `accent`, `primary`, …) and points each `gpui_component::ThemeColor`
//! field at the matching CSS variable.
//!
//! Keep this file in lockstep with `src/index.css` — any CSS variable
//! change there must land here in the same commit.
//!
//! Values are stored as 24-bit hex (`0xRRGGBB`) or 32-bit hex with
//! alpha (`0xRRGGBBAA`).  rgba()-style CSS values are rounded to the
//! nearest 8-bit alpha — the eyeballed difference is well below the
//! periscope diff threshold.

use gpui::{rgb, rgba, Hsla};
use gpui_component::theme::{Theme, ThemeColor};

fn h(c: u32) -> Hsla {
    rgb(c).into()
}

fn ha(c: u32) -> Hsla {
    rgba(c).into()
}

/// Overwrite `theme`'s `ThemeColor` block with the Tauri-era **light**
/// palette from `src/index.css`.
pub fn apply_light(theme: &mut Theme) {
    let c: &mut ThemeColor = theme;

    // --- Surfaces (shadcn aliases at the bottom of the light block) ---
    // NOTE: `gpui_component::ThemeColor` has no dedicated `card`
    // token — chrome that wants a card surface reads `popover`
    // (visually equivalent in both light and dark).
    c.background = h(0xFFFFFF); // --surface-app
    c.popover = h(0xFFFFFF); // --surface-popover, also covers --surface-card
    c.popover_foreground = h(0x37352F);
    c.sidebar = h(0xF7F6F3); // --surface-sidebar
    c.sidebar_foreground = h(0x37352F);
    c.sidebar_border = h(0xE9E9E7);
    c.sidebar_primary = h(0x155DFF);
    c.sidebar_primary_foreground = h(0xFFFFFF);
    c.sidebar_accent = h(0xE8F4FE); // --state-selected
    c.sidebar_accent_foreground = h(0x37352F);

    // --- Text + borders ---
    c.foreground = h(0x37352F); // --text-primary
    c.muted_foreground = h(0x787774); // --text-secondary
    c.muted = h(0xF0F0EF); // --state-hover-subtle
    c.border = h(0xE9E9E7); // --border-default
    c.input = h(0xE9E9E7); // --border-input
    c.ring = h(0x155DFF); // --state-focus-ring

    // --- Primary / accent (shadcn names) ---
    c.primary = h(0x155DFF); // --accent-blue
    c.primary_active = h(0x0D4AD6);
    c.primary_hover = h(0x0D4AD6);
    c.primary_foreground = h(0xFFFFFF);
    c.secondary = h(0xEBEBEA); // --state-hover
    c.secondary_active = h(0xEBEBEA);
    c.secondary_hover = h(0xEBEBEA);
    c.secondary_foreground = h(0x37352F);
    c.accent = h(0xEBEBEA); // --state-hover
    c.accent_foreground = h(0x37352F);
    c.selection = ha(0x155DFF40); // --state-active w/ visible alpha

    // --- Feedback ---
    c.danger = h(0xE53E3E); // --accent-red
    c.danger_active = h(0xE53E3E);
    c.danger_hover = h(0xE53E3E);
    c.danger_foreground = h(0xFFFFFF);
    c.success = h(0x38A169); // --accent-green
    c.success_active = h(0x38A169);
    c.success_hover = h(0x38A169);
    c.success_foreground = h(0xFFFFFF);
    c.warning = h(0xD9730D); // --accent-orange
    c.warning_active = h(0xD9730D);
    c.warning_hover = h(0xD9730D);
    c.warning_foreground = h(0xFFFFFF);
    c.info = h(0x155DFF);
    c.info_active = h(0x155DFF);
    c.info_hover = h(0x155DFF);
    c.info_foreground = h(0xFFFFFF);

    // --- Misc surfaces ---
    c.tab_bar = h(0xF7F6F3);
    c.tab = h(0xFFFFFF);
    c.tab_active = h(0xFFFFFF);
    c.tab_foreground = h(0x787774);
    c.tab_active_foreground = h(0x37352F);
    c.list = h(0xFFFFFF);
    c.list_active = h(0xE8F4FE);
    // `list_hover` is the row-hover paint used by both `sidebar_panel`
    // and `note_list_pane`.  It mirrors React's `hover:bg-muted` →
    // `--muted` → `--state-hover-subtle` (`#F0F0EF`, see
    // `src/index.css:56`), so the native chrome's hover state stays
    // in lockstep with the Tauri build (issue 015).
    c.list_hover = h(0xF0F0EF);
    c.list_even = h(0xFFFFFF);
    c.list_head = h(0xF7F6F3);
    c.list_active_border = h(0x155DFF);
    // Transparent track (issue 014): the gpui-component scrollbar
    // paints `theme.scrollbar` as the strip BEHIND the thumb when
    // visible.  An opaque pale-grey strip obscured the right edge
    // of the note-list rows during scroll.  Making the track itself
    // transparent gives an overlay-style scrollbar — thumb visible
    // against the row content, no rectangular track painted.
    c.scrollbar = ha(0x00000000);
    c.scrollbar_thumb = h(0xD9D9D6);
    c.scrollbar_thumb_hover = h(0xB4B4B4);
    // `drag_border` doubles as the active-state colour for
    // gpui-component's `ResizeHandle` (`crates/ui/src/resizable/
    // resize_handle.rs`).  We route it through `c.muted_foreground`
    // (a neutral darker grey, `#787774` light / `#B8B1A6` dark)
    // instead of the original accent blue so the resize divider
    // reads as a darker grey while the user drags — matching the
    // React resize-handle `:hover` paint
    // (`src/components/ResizeHandle.tsx:70`,
    // `hover:bg-[var(--border)]`).
    //
    // Hover-only feedback (without an active drag) is not separately
    // styleable today — gpui-component's `group_hover` closure
    // reuses the same `bg_color` as idle.  Patching upstream would
    // unlock distinct hover colour + the 3-pt thicker bar React
    // shows on hover; until that lands, drag is the only state
    // that visually differs from idle.
    //
    // `c.drop_target` keeps its translucent blue tint independently.
    c.drag_border = c.muted_foreground;
    c.drop_target = ha(0x155DFF24); // --state-drag-target
    c.caret = h(0x155DFF);
    c.link = h(0x155DFF);
    c.link_active = h(0x0D4AD6);
    c.link_hover = h(0x0D4AD6);
}

/// Overwrite `theme`'s `ThemeColor` block with the Tauri-era **dark**
/// palette from `src/index.css`.
pub fn apply_dark(theme: &mut Theme) {
    let c: &mut ThemeColor = theme;

    // --- Surfaces ---
    c.background = h(0x1F1E1B); // --surface-app
    c.popover = h(0x292823); // also covers --surface-card
    c.popover_foreground = h(0xE6E1D8);
    c.sidebar = h(0x191814);
    c.sidebar_foreground = h(0xE6E1D8);
    c.sidebar_border = h(0x34322D);
    c.sidebar_primary = h(0x78A4FF);
    c.sidebar_primary_foreground = h(0x151411);
    c.sidebar_accent = h(0x1E344C); // --state-selected (dark)
    c.sidebar_accent_foreground = h(0xE6E1D8);

    // --- Text + borders ---
    c.foreground = h(0xE6E1D8);
    c.muted_foreground = h(0xB8B1A6);
    c.muted = h(0x262520);
    c.border = h(0x34322D);
    c.input = h(0x3A3832);
    c.ring = h(0x78A4FF);

    // --- Primary / accent ---
    c.primary = h(0x78A4FF);
    c.primary_active = h(0x9BBEFF);
    c.primary_hover = h(0x9BBEFF);
    c.primary_foreground = h(0x151411);
    c.secondary = h(0x2D2B27);
    c.secondary_active = h(0x2D2B27);
    c.secondary_hover = h(0x2D2B27);
    c.secondary_foreground = h(0xE6E1D8);
    c.accent = h(0x2D2B27);
    c.accent_foreground = h(0xE6E1D8);
    c.selection = ha(0x78A4FF40);

    // --- Feedback ---
    c.danger = h(0xFF8A86);
    c.danger_active = h(0xFF8A86);
    c.danger_hover = h(0xFF8A86);
    c.danger_foreground = h(0x151411);
    c.success = h(0x79D89D);
    c.success_active = h(0x79D89D);
    c.success_hover = h(0x79D89D);
    c.success_foreground = h(0x151411);
    c.warning = h(0xF3A15B);
    c.warning_active = h(0xF3A15B);
    c.warning_hover = h(0xF3A15B);
    c.warning_foreground = h(0x151411);
    c.info = h(0x78A4FF);
    c.info_active = h(0x78A4FF);
    c.info_hover = h(0x78A4FF);
    c.info_foreground = h(0x151411);

    // --- Misc surfaces ---
    c.tab_bar = h(0x191814);
    c.tab = h(0x23221F);
    c.tab_active = h(0x23221F);
    c.tab_foreground = h(0xB8B1A6);
    c.tab_active_foreground = h(0xE6E1D8);
    c.list = h(0x23221F);
    c.list_active = h(0x1E344C);
    // `list_hover` mirrors React's `hover:bg-muted` (issue 015):
    // `--muted` resolves to `--state-hover-subtle`, which is
    // `#262520` in the dark palette of `src/index.css:207`.  The
    // previous value (`#2D2B27`, i.e. `--state-hover`) was the
    // non-subtle hover and read as too contrasted on dark rows.
    c.list_hover = h(0x262520);
    c.list_even = h(0x1F1E1B);
    c.list_head = h(0x191814);
    c.list_active_border = h(0x78A4FF);
    // Transparent track (issue 014) — see the light-palette comment
    // for the rationale.  Dark theme uses the same overlay style so
    // the gutter to the right of the note list reads as a single
    // continuous column, not a stripe.
    c.scrollbar = ha(0x00000000);
    c.scrollbar_thumb = h(0x46433B);
    c.scrollbar_thumb_hover = h(0x625B53);
    // See light-palette comment — route `ResizeHandle`'s active
    // colour through `c.muted_foreground` (`#B8B1A6`) so the
    // divider reads as a distinct neutral grey during drag.
    // gpui-component reuses the same colour for hover today, so
    // hover-only feedback is identical to idle until upstream
    // grows a distinct hover colour + 3-pt width.
    c.drag_border = c.muted_foreground;
    c.drop_target = ha(0x78A4FF33);
    c.caret = h(0x78A4FF);
    c.link = h(0x78A4FF);
    c.link_active = h(0x9BBEFF);
    c.link_hover = h(0x9BBEFF);
}
