# Zed Title Bar — Reverse-Engineering Notes

Source tree analysed: `/Users/konstantin/zed` (read-only). All `file:line`
references below are into that tree. Tolaria should mirror the values called
out in section 5.

---

## 1. `WindowOptions` / `TitlebarOptions` at workspace open

Zed registers a `build_window_options: fn(Option<Uuid>, &mut App) -> WindowOptions`
on `AppState` (`crates/workspace/src/workspace.rs:1104`). The wiring is:

- `crates/zed/src/main.rs:77` re-exports `build_window_options` from `zed.rs`.
- `crates/zed/src/main.rs:651` installs it on `AppState`.
- The workspace open path calls it back at
  `crates/workspace/src/workspace.rs:2023`
  (`let mut options = cx.update(|cx| (app_state.build_window_options)(display, cx));`)
  and then `cx.open_window(options, …)` at line `2029`.
  (Same pattern at `workspace.rs:9756` and `:10357`.)

The leaf literal lives in `crates/zed/src/zed.rs:349-376`:

```rust
WindowOptions {
    titlebar: Some(TitlebarOptions {
        title: None,
        appears_transparent: true,
        traffic_light_position: Some(point(px(9.0), px(9.0))),
    }),
    window_bounds: None,
    focus: false,
    show: false,
    kind: WindowKind::Normal,
    is_movable: true,
    display_id: display.map(|display| display.id()),
    window_background: cx.theme().window_background_appearance(),
    app_id: Some(app_id.to_owned()),
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    icon: APP_ICON.as_ref().cloned(),
    window_decorations: Some(window_decorations),
    window_min_size: Some(gpui::Size { width: px(360.0), height: px(240.0) }),
    tabbing_identifier: if use_system_window_tabs { Some(String::from("zed")) } else { None },
    ..Default::default()
}
```

Key values for the workspace window:

| Field                              | Value                                    |
| ---------------------------------- | ---------------------------------------- |
| `titlebar.title`                   | `None`                                   |
| `titlebar.appears_transparent`     | `true`                                   |
| `titlebar.traffic_light_position`  | `Some(point(px(9.0), px(9.0)))`          |
| `window_decorations`               | from the `window_decorations` setting (`Some(...)`) |
| `window_min_size`                  | `Some({ width: 360, height: 240 })`      |
| `kind`                             | `WindowKind::Normal`                     |
| `is_movable`                       | `true`                                   |
| `tabbing_identifier`               | `"zed"` when system tabs are enabled     |

For comparison, the secondary "About Zed" window uses
`traffic_light_position: Some(point(px(12.), px(12.)))` at
`crates/zed/src/zed.rs:1549` — Zed pulls the lights inward another 3px when the
window is fixed-size and decorative. The workspace itself stays on `(9, 9)`.

`TitlebarOptions` itself is defined at
`crates/gpui/src/platform.rs:1564-1574`:

```rust
pub struct TitlebarOptions {
    pub title: Option<SharedString>,
    pub appears_transparent: bool,           // hides system titlebar on macOS/Windows
    pub traffic_light_position: Option<Point<Pixels>>,
}
```

`WindowOptions::default()` (`crates/gpui/src/platform.rs:1536-1559`) returns a
`Some(TitlebarOptions { ..Default::default() })`, so leaving the field unset
gives you a system titlebar with default traffic-light position.

---

## 2. Title-bar entity that draws the strip

### Crate layout

- `crates/title_bar/src/title_bar.rs` — the high-level `TitleBar` view that
  wraps Zed-specific content (project picker, branch, collab pill, user menu).
- `crates/platform_title_bar/src/platform_title_bar.rs` — the lower-level
  `PlatformTitleBar` view that actually paints the strip, sets the height,
  reserves the traffic-light gap, and dispatches per-platform window controls.

### Height

Single source of truth: `crates/ui/src/utils/constants.rs:14-27`:

```rust
#[cfg(not(target_os = "windows"))]
pub fn platform_title_bar_height(window: &Window) -> Pixels {
    (1.75 * window.rem_size()).max(px(34.))
}

#[cfg(target_os = "windows")]
pub fn platform_title_bar_height(_window: &Window) -> Pixels {
    px(32.)
}
```

`Window::rem_size` defaults to `px(16.)`
(`crates/gpui/src/window.rs:1585`), so the macOS/Linux strip is
`1.75 * 16 = 28px`, then clamped up to `max(px(34.))` ⇒ **34 px** by default.
The strip grows with the user's UI font size; below 19.43 rem-px the clamp
kicks in.

Windows is a flat `32 px`.

The height is plumbed into the strip at
`crates/platform_title_bar/src/platform_title_bar.rs:187` and `:198`
(`.h(height)`), and re-used by callers like
`crates/title_bar/src/title_bar.rs:357`,
`crates/inspector_ui/src/inspector.rs:63`,
`crates/sidebar/src/sidebar.rs:5079`,
`crates/agent_ui/src/threads_archive_view.rs:854`.

### Vertical alignment

`PlatformTitleBar::render` (`crates/platform_title_bar/src/platform_title_bar.rs:195-293`)
builds the strip as an `h_flex().h(height).items_center()`-style row. Look at
the inner `div` that hosts `children` (`:284-292`):

```rust
.child(
    div()
        .id(self.id.clone())
        .flex()
        .flex_row()
        .items_center()          // <-- vertical alignment of action cells
        .justify_between()
        .overflow_x_hidden()
        .w_full()
        .children(children),
)
```

So the **action cells are centered on the strip's vertical axis** — Zed does
*not* top-align them. Because the strip is 34 px and the traffic lights are
14 px tall (macOS native), the lights sit centered ± 1 px and the centered
content rides right alongside them.

### Left padding for the traffic lights

Constant: `crates/ui/src/utils/constants.rs:8-12`:

```rust
#[cfg(macos_sdk_26)]
pub const TRAFFIC_LIGHT_PADDING: f32 = 78.;

#[cfg(not(macos_sdk_26))]
pub const TRAFFIC_LIGHT_PADDING: f32 = 71.;
```

Comment in the file notes: *"there is one extra pixel of padding on the left
side due to the 1px border around the window on macOS apps."*

Applied at `crates/platform_title_bar/src/platform_title_bar.rs:240-260`:

```rust
if window.is_fullscreen() {
    this.pl_2()
} else if self.platform_style == PlatformStyle::Mac && show_left_controls {
    this.pl(px(TRAFFIC_LIGHT_PADDING))                  // 71 (or 78 on Tahoe)
} else if let Some(controls) = …left_window_controls(…) {
    this.child(controls)                                 // Linux CSD
} else {
    this.pl_2()                                          // 8px fallback
}
```

So on macOS the strip starts at `pl(71)` (or `78` on the Tahoe SDK) when the
traffic lights are visible, drops to `pl_2()` (~8 px) in fullscreen, and lets
Linux render its own controls inline.

### Action-cell / icon dimensions

The strip itself doesn't fix cell sizes; each child component decides. The
size baseline is the shared `ui` crate (`crates/ui/src`) tokens — the
`Button`/`ButtonLike`/`Icon` API uses `IconSize::Small` / `IconSize::XSmall`
inside the title bar (e.g. `title_bar.rs:660-664`, `:805-807`, `:969-972`,
`:1010-1012`). `IconSize::Small` is `14 px`, `IconSize::XSmall` is `12 px`
(grep `enum IconSize` under `crates/ui/src` for the table). Because the row is
`items_center` and the strip is 34 px, those icons render with ~10 px of
breathing room top + bottom.

There is no hard-coded action-cell width on the strip itself — children flex
naturally. The collab/pill section uses `gap_1` (4 px) and per-child padding
`pr_1`/`pr_1p5` at `title_bar.rs:308-315`. The leftmost group uses `gap_0p5`
(`title_bar.rs:244`).

### Separate Mac / Windows / Linux paths

All paths live inside `PlatformTitleBar::render`:

- **Mac** — relies on the native NSWindow traffic lights, just reserves
  `TRAFFIC_LIGHT_PADDING` on the left
  (`platform_title_bar.rs:245-246`).
- **Linux** — when CSD: renders `platform_linux::LinuxWindowControls` on the
  left (and/or right) at `platform_title_bar.rs:248-257` and `:167-174`;
  has an active/inactive title-bar color
  (`platform_title_bar.rs:63-72`); honours a `Decorations::Client { tiling }`
  path that rounds top corners and draws a 1 px border
  (`:262-280`).
- **Windows** — flat 32 px height
  (`ui/src/utils/constants.rs:24`); `WindowsWindowControls` is appended on the
  right inside `render_right_window_controls`
  (`platform_title_bar.rs:177`).

---

## 3. Traffic-light interaction

Zed **pins** the macOS traffic lights via `TitlebarOptions::traffic_light_position`
and also offsets its content to match. The y coordinate it passes for the
workspace window is `px(9.0)` (see section 1).

The position is consumed in `crates/gpui_macos/src/window.rs`:

- Stored at `:491` (`traffic_light_position: Option<Point<Pixels>>`) and
  initialised from `TitlebarOptions` at `:817-819`.
- Applied by `MacWindowState::move_traffic_light` at `:511-561`. The y math:

  ```rust
  // crates/gpui_macos/src/window.rs:538-544
  let mut origin = point(
      traffic_light_position.x,
      titlebar_height
          - traffic_light_position.y
          - px(close_button_frame.size.height as f32),
  );
  ```

  In words: the y you pass is the **distance from the top of the titlebar to
  the top of the close button**. AppKit uses bottom-up coordinates, so Zed
  flips it: `origin.y = titlebar_height - desired_top - button_height`.
  `titlebar_height` here is the AppKit-reported strip height
  (`:641-647`), which on a transparent-titlebar window matches the
  `frame.size.height - contentLayoutRect.size.height` delta — usually 28 px
  on a standard mac titlebar before SDK 26 (Tahoe), where it grows.

- `move_traffic_light` is re-invoked from many lifecycle hooks
  (`:993, :1384, :1474, :1486, :2231, :2241, :2379, :2976`) so the lights
  stay pinned across resize / fullscreen-toggle / appearance change.

So Zed both (a) tells AppKit where to draw the native lights, and (b) reserves
`TRAFFIC_LIGHT_PADDING` (71 px / 78 px on Tahoe) on its own strip so its
content never overlaps them.

---

## 4. Layout diagram

Default macOS, `rem_size = 16`, `traffic_light_position = (9, 9)`, no Tahoe.
All values in px, y grows downward from the top of the strip.

```
y =  0  ┌───────────────────────────────────────────────────────────────┐  top of strip
        │                                                               │
        │    ●   ●   ●                                                  │
y =  9  │    ↑   ↑   ↑                                                  │  top of close button
        │    │   │   │     (button height ≈ 14, native NSWindow         │
        │    │   │   │      traffic lights – not a Zed constant)        │
y = 16  │    ─   ─   ─                                                  │  center of buttons (≈)
        │                                                               │
y = 23  │                  [ project ▾ ]  /  [ branch ▾ ]  …            │  bottom of buttons (≈)
        │                                                               │
y = 34  └───────────────────────────────────────────────────────────────┘  bottom of strip
        │                                                               │
        │← pl(71)  →│ children (items_center, justify_between, pr_1p5) │
```

Notes:

- Strip height = `max(1.75 * rem_size, 34)` = `34` at default rem.
- Traffic-light y = `9` is the **top inset** of the close-button frame
  (Zed flips into AppKit's bottom-up coords internally).
- Action cells (project picker, branch, collab pill, user menu) are
  vertically centered on the 34-px strip via `items_center` in the inner
  `div` at `platform_title_bar.rs:284-292`.
- Left padding before children is `pl(TRAFFIC_LIGHT_PADDING) = pl(71)`
  (non-Tahoe macOS), dropping to `pl_2()` in fullscreen.
- Right padding before user menu/avatar is `pr_1p5()` (~6 px) when signed
  in, `pr_1()` (~4 px) otherwise — see `title_bar.rs:310-315`.
- Inter-action gap on the right cluster is `gap_1` (4 px); on the left
  cluster it's `gap_0p5` (2 px).

---

## 5. Copy-this list for Tolaria

To match Zed exactly in
`/Users/konstantin/tolaria/crates/tolaria/src/main.rs` (`TitlebarOptions`
construction) and
`/Users/konstantin/tolaria/crates/workspace/src/title_bar.rs`:

### `TitlebarOptions` literal — mirror verbatim

```rust
TitlebarOptions {
    title: None,
    appears_transparent: true,
    traffic_light_position: Some(point(px(9.0), px(9.0))),
}
```

Source: `crates/zed/src/zed.rs:350-354`.

### Title-bar strip in `workspace/src/title_bar.rs`

| Concept                       | Value                              | Citation                                                |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------- |
| Strip height (mac/linux)      | `(1.75 * rem_size).max(px(34.))`   | `crates/ui/src/utils/constants.rs:19-21`                |
| Strip height (windows)        | `px(32.)`                          | `crates/ui/src/utils/constants.rs:24-27`                |
| `TRAFFIC_LIGHTS_PADDING_PT`   | `px(71.)` (or `px(78.)` on Tahoe)  | `crates/ui/src/utils/constants.rs:8-12`                 |
| Vertical alignment of cells   | `items_center` on the inner row    | `crates/platform_title_bar/src/platform_title_bar.rs:284-292` |
| Fullscreen left padding       | `pl_2()` (~8 px)                   | `crates/platform_title_bar/src/platform_title_bar.rs:243-244` |
| Right-cluster trailing pad    | `pr_1p5()` signed in, else `pr_1()`| `crates/title_bar/src/title_bar.rs:310-315`             |
| Right-cluster gap             | `gap_1()` (4 px)                   | `crates/title_bar/src/title_bar.rs:316`                 |
| Left-cluster gap              | `gap_0p5()` (2 px)                 | `crates/title_bar/src/title_bar.rs:244`                 |
| Drag region                   | `.window_control_area(WindowControlArea::Drag)` on the strip | `crates/platform_title_bar/src/platform_title_bar.rs:196` |
| Double-click maximize         | `window.titlebar_double_click()` on Mac | `crates/platform_title_bar/src/platform_title_bar.rs:226-230` |
| Background                    | `cx.theme().colors().title_bar_background` (active) / `title_bar_inactive_background` (linux, inactive) | `crates/platform_title_bar/src/platform_title_bar.rs:63-72` |
| Action-icon size              | `IconSize::Small` (14 px) for primary, `IconSize::XSmall` (12 px) for trailing chevrons | `crates/title_bar/src/title_bar.rs:660-664, :805-807, :969-972` |

### Concrete numeric defaults Tolaria can hard-code

- `TITLE_BAR_HEIGHT_PT = 34.0` (macOS, default rem) — derive with the same
  `max(1.75 * rem, 34)` formula so HiDPI font scaling still works.
- `TRAFFIC_LIGHTS_PADDING_PT = 71.0` for the leading inset (bump to `78.0`
  behind a `cfg!(macos_sdk_26)` gate once we target Tahoe).
- `TitlebarOptions::traffic_light_position = Some(point(px(9.0), px(9.0)))`
  — y=9 is the **top inset** of the close button on the 28-px AppKit
  titlebar; Zed flips it internally
  (`crates/gpui_macos/src/window.rs:539-544`), so callers just pass
  `(left_inset, top_inset)` in window coordinates.
- `appears_transparent: true` is mandatory for a custom strip on macOS —
  the system titlebar is hidden and Zed paints its own theme-coloured row.

If we want our action cells to top-align with the traffic lights the way Zed
does, we just keep the row at `items_center` on a 34-px strip — *do not*
introduce a manual top inset. The math at `gpui_macos/src/window.rs:538-544`
places the close button so its top is at `y = 9` inside a 28-px AppKit
titlebar; once GPUI's transparent-titlebar mode is on, the 34-px strip we
render sits flush with the top of the window, the lights sit at native y=9,
and a `items_center` row centers our 14-px icons at y≈10, which lands within
±1 px of the lights' visual center.
