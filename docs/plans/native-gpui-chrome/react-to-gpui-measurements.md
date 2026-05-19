# React/Tailwind to GPUI Measurements

> Grep this doc when porting `px-3 py-2.5 gap-2 text-sm font-semibold` (and
> friends) from the React/Tailwind chrome in `src/` to the native GPUI port in
> `crates/`. Title-bar-specific values live in
> [`zed-title-bar-analysis.md`](./zed-title-bar-analysis.md) — they are not
> repeated here.

---

## 1. Why this doc exists

ADR-0115 Phase 7 ports the chrome from React/Tailwind to GPUI +
`gpui-component`. Every visual-fidelity pass triggers the same translation
question: "what GPUI builder gives me the px value Tailwind class `X` would
produce?". The answer is mechanical but each lookup costs a side trip to
`gpui_macros/src/styles.rs`. This page is the single grep-friendly cheat
sheet. Authoritative source for the GPUI side is
`/Users/konstantin/.cargo/git/checkouts/zed-a70e2ad075855582/8ca194d/crates/gpui_macros/src/styles.rs`
(the proc-macro that *generates* every `.p_N()` / `.gap_N()` / `.border_N()`
method on `Styled`). The React side is `src/index.css` + the Tailwind v4
defaults.

Rem is **`16 px`** by default in GPUI (`window.rem_size()` —
`crates/gpui/src/window.rs:1585`) and in the Tailwind v4 build used by
Tolaria. The browser-side root font is overridden to `14px` in
`src/index.css:14`, but `rem`-based Tailwind utilities still resolve to
multiples of the *Tailwind* default (which equals the GPUI default), so the
side-by-side table below holds.

---

## 2. Quick reference: Tailwind ↔ GPUI

### 2.1 The numeric spacing scale (shared by `p`, `m`, `gap`, `w`, `h`, `size`, `top`, `left`, `right`, `bottom`, `inset`, `min_w`, `min_h`, `max_w`, `max_h`)

| Tailwind | px (@ rem=16) | GPUI suffix | Notes |
| --- | --- | --- | --- |
| `0`    | `0`     | `_0`        | |
| `px`   | `1`     | `_px`       | literal 1 px (e.g. `.h_px()`) |
| `0.5`  | `2`     | `_0p5`      | |
| `1`    | `4`     | `_1`        | |
| `1.5`  | `6`     | `_1p5`      | |
| `2`    | `8`     | `_2`        | |
| `2.5`  | `10`    | `_2p5`      | |
| `3`    | `12`    | `_3`        | |
| `3.5`  | `14`    | `_3p5`      | |
| `4`    | `16`    | `_4`        | 1 rem |
| `5`    | `20`    | `_5`        | |
| `6`    | `24`    | `_6`        | |
| `7`    | `28`    | `_7`        | |
| `8`    | `32`    | `_8`        | |
| `9`    | `36`    | `_9`        | |
| `10`   | `40`    | `_10`       | |
| `11`   | `44`    | `_11`       | |
| `12`   | `48`    | `_12`       | |
| `16`   | `64`    | `_16`       | |
| `20`   | `80`    | `_20`       | |
| `24`   | `96`    | `_24`       | |
| `32`   | `128`   | `_32`       | |
| `40`   | `160`   | `_40`       | |
| `48`   | `192`   | `_48`       | |
| `56`   | `224`   | `_56`       | |
| `64`   | `256`   | `_64`       | |
| `72`   | `288`   | `_72`       | |
| `80`   | `320`   | `_80`       | |
| `96`   | `384`   | `_96`       | |
| `112`  | `448`   | `_112`      | |
| `128`  | `512`   | `_128`      | |
| `auto` | n/a     | `_auto`     | `m_auto()`, `w_auto()` etc. only on auto-allowed prefixes |
| `full` | 100%    | `_full`     | `w_full()`, `h_full()` |
| `1/2`  | 50%     | `_1_2`      | `w_1_2()` |
| `1/3`  | 33%     | `_1_3`      | |
| `2/3`  | 66%     | `_2_3`      | |
| `1/4`  | 25%     | `_1_4`      | |
| `3/4`  | 75%     | `_3_4`      | |
| `1/5`–`5/6`, `1/12` | …     | `_<n>_<d>`  | full set in styles.rs:1142-1206 |

Source: `gpui_macros/src/styles.rs:975-1208`.

Escape hatch for any non-tabulated value: `.p(px(13.0))`, `.gap(px(7.0))`,
`.h(px(34.0))` etc. Accepts anything implementing `Into<DefiniteLength>` —
typically `Pixels`, `Rems`, `Length`.

### 2.2 Padding — `p`, `px`, `py`, `pt`, `pr`, `pb`, `pl`

| Tailwind        | GPUI                       |
| ---             | ---                        |
| `p-3`           | `.p_3()`                   |
| `px-3`          | `.px_3()`                  |
| `py-2.5`        | `.py_2p5()`                |
| `pt-1.5 pr-1.5` | `.pt_1p5().pr_1p5()`       |
| `px-[7px]`      | `.px(px(7.0))`             |

`padding_box_style_prefixes()` — `gpui_macros/src/styles.rs:800-849`. No
`auto` on padding (only margin allows `auto`).

### 2.3 Margin — `m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml`

Same scale + same suffixes as padding. `auto` *is* allowed:

| Tailwind | GPUI |
| --- | --- |
| `m-4`     | `.m_4()`         |
| `mx-auto` | `.mx_auto()`     |
| `-mt-1`   | `.mt_neg_1()`    | (negation: see `generate_predefined_setter` in `styles.rs:680-685`) |

Source: `gpui_macros/src/styles.rs:748-797`.

### 2.4 Gap — `gap`, `gap-x`, `gap-y`

| Tailwind   | GPUI         |
| ---        | ---          |
| `gap-2`    | `.gap_2()`   |
| `gap-x-3`  | `.gap_x_3()` |
| `gap-y-1`  | `.gap_y_1()` |

`gap` works only on flex/grid parents (same as CSS). Source:
`gpui_macros/src/styles.rs:954-971`.

### 2.5 Width / height / size / min / max

| Tailwind     | GPUI                |
| ---          | ---                 |
| `w-full`     | `.w_full()`         |
| `w-96`       | `.w_96()` (384 px)  |
| `w-[200px]`  | `.w(px(200.0))`     |
| `h-screen`   | n/a — use `.h_full()` on root, or `window.viewport_size()` |
| `size-4`     | `.size_4()` (16×16) |
| `min-w-0`    | `.min_w_0()`        |
| `min-h-0`    | `.min_h_0()`        |
| `max-w-md`   | `.max_w(rems(28.))` — there is **no** Tailwind-named `max_w_md` shortcut, only the numeric scale (TODO in `styles.rs:925`) |

Sources: `box_prefixes()` — `gpui_macros/src/styles.rs:892-973`.

### 2.6 Text size + weight

Tailwind / GPUI `Styled` use the same rem ramp (`gpui/src/styled.rs:520-567`):

| Tailwind     | rem    | px (@ rem=16) | GPUI                |
| ---          | ---    | ---           | ---                 |
| `text-xs`    | 0.75   | 12            | `.text_xs()`        |
| `text-sm`    | 0.875  | 14            | `.text_sm()`        |
| `text-base`  | 1.0    | 16            | `.text_base()`      |
| `text-lg`    | 1.125  | 18            | `.text_lg()`        |
| `text-xl`    | 1.25   | 20            | `.text_xl()`        |
| `text-2xl`   | 1.5    | 24            | `.text_2xl()`       |
| `text-3xl`   | 1.875  | 30            | `.text_3xl()`       |
| `text-[13px]`| —      | 13            | `.text_size(px(13.))`|

Font weight — `StyledExt` from `gpui-component`
(`/Users/konstantin/.cargo/git/checkouts/gpui-component-95ce574d8a0da8b8/a5268cd/crates/ui/src/styled.rs:142-150`):

| Tailwind        | GPUI               |
| ---             | ---                |
| `font-thin`     | `.font_thin()`     |
| `font-extralight` | `.font_extralight()` |
| `font-light`    | `.font_light()`    |
| `font-normal`   | `.font_normal()`   |
| `font-medium`   | `.font_medium()`   |
| `font-semibold` | `.font_semibold()` |
| `font-bold`     | `.font_bold()`     |
| `font-extrabold`| `.font_extrabold()`|
| `font-black`    | `.font_black()`    |

Line height: `.line_height(rems(1.4))` — GPUI uses absolute `Rems` /
`Pixels`, there is no `leading_normal()` / `leading_tight()` builder.

Text alignment / decoration:

| Tailwind        | GPUI                       |
| ---             | ---                        |
| `text-left`     | `.text_left()`             |
| `text-center`   | `.text_center()`           |
| `text-right`    | `.text_right()`            |
| `italic`        | `.italic()`                |
| `underline`     | `.underline()`             |
| `line-through`  | `.line_through()`          |
| `truncate`      | `.truncate()` (single-line ellipsis — `gpui/src/styled.rs:131`) |
| `line-clamp-2`  | `.line_clamp(2)` (`styled.rs:137`) |
| `text-ellipsis` | `.text_ellipsis()` (`gpui-component`, manual `text_overflow`) |

### 2.7 Flex / grid

| Tailwind          | GPUI                  |
| ---               | ---                   |
| `flex`            | `.flex()`             |
| `flex-row`        | `.flex_row()`         |
| `flex-row-reverse`| `.flex_row_reverse()` |
| `flex-col`        | `.flex_col()`         |
| `flex-1`          | `.flex_1()`           |
| `flex-auto`       | `.flex_auto()`        |
| `flex-initial`    | `.flex_initial()`     |
| `flex-none`       | `.flex_none()`        |
| `flex-grow`       | `.flex_grow()`        |
| `flex-grow-0`     | `.flex_grow_0()`      |
| `flex-shrink`     | `.flex_shrink()`      |
| `flex-shrink-0`   | `.flex_shrink_0()`    |
| `flex-wrap`       | `.flex_wrap()`        |
| `flex-nowrap`     | `.flex_nowrap()`      |
| `items-start`     | `.items_start()`      |
| `items-center`    | `.items_center()`     |
| `items-end`       | `.items_end()`        |
| `items-baseline`  | `.items_baseline()`   |
| `items-stretch`   | `.items_stretch()`    |
| `justify-start`   | `.justify_start()`    |
| `justify-center`  | `.justify_center()`   |
| `justify-end`     | `.justify_end()`      |
| `justify-between` | `.justify_between()`  |
| `justify-around`  | `.justify_around()`   |
| `justify-evenly`  | `.justify_evenly()`   |
| `self-start`      | `.self_start()` (Styled methods) |
| `self-center`     | `.self_center()`      |
| `self-stretch`    | `.self_stretch()`     |

Sources: `gpui/src/styled.rs:145-388`. Convenience helpers
`h_flex()` / `v_flex()` from `gpui_component` are
`div().flex().flex_row().items_center()` and `div().flex().flex_col()`
respectively (`crates/ui/src/styled.rs:10-18, 64-72`).

### 2.8 Border width + radius + color

Border widths (`gpui_macros/src/styles.rs:1378-1466`):

| Tailwind     | px | GPUI            |
| ---          | -- | ---             |
| `border`     | 1  | `.border_1()`   |
| `border-0`   | 0  | `.border_0()`   |
| `border-2`   | 2  | `.border_2()`   |
| `border-4`   | 4  | `.border_4()`   |
| `border-8`   | 8  | `.border_8()`   |
| `border-t`   | 1  | `.border_t_1()` |
| `border-r`   | 1  | `.border_r_1()` |
| `border-b`   | 1  | `.border_b_1()` |
| `border-l`   | 1  | `.border_l_1()` |
| `border-x-2` | 2  | `.border_x_2()` |
| `border-y-2` | 2  | `.border_y_2()` |
| `border-[3px]` | 3 | `.border(px(3.))` |

Color is **single-valued, all four sides** —
`.border_color(theme.border)`. There is **no** `.border_l_color(…)`. See
§5 for the flex-sibling workaround already used in `note_list_pane`.

Rounded corners (`gpui_macros/src/styles.rs:1277-1325`):

| Tailwind        | px        | GPUI                |
| ---             | --        | ---                 |
| `rounded-none`  | 0         | `.rounded_none()`   |
| `rounded-xs`    | 2         | `.rounded_xs()`     |
| `rounded-sm`    | 4         | `.rounded_sm()`     |
| `rounded`/`rounded-md` | 6  | `.rounded_md()`     |
| `rounded-lg`    | 8         | `.rounded_lg()`     |
| `rounded-xl`    | 12        | `.rounded_xl()`     |
| `rounded-2xl`   | 16        | `.rounded_2xl()`    |
| `rounded-3xl`   | 24        | `.rounded_3xl()`    |
| `rounded-full`  | 9999      | `.rounded_full()`   |
| `rounded-t-md`  | 6 top     | `.rounded_t_md()`   |
| `rounded-l-md`  | 6 left    | `.rounded_l_md()`   |
| `rounded-tl-md` | 6 top-left| `.rounded_tl_md()`  |

(`rounded` alone in Tailwind v4 = 4 px = `rounded-sm`; in older Tailwind it
was 4 px. Tolaria's `--radius` is `0.5rem = 8 px` and is mapped to
`rounded_lg` by shadcn aliases — see `src/index.css:128, 367`.)

Border style: `.border_dashed()` (`gpui/src/styled.rs:477`). No
`border_dotted` builder.

### 2.9 Overflow + scroll

| Tailwind            | GPUI                                |
| ---                 | ---                                 |
| `overflow-hidden`   | `.overflow_hidden()`                |
| `overflow-x-hidden` | `.overflow_x_hidden()`              |
| `overflow-y-hidden` | `.overflow_y_hidden()`              |
| `overflow-scroll`   | use scrollable parent (see below)   |
| `overflow-y-auto`   | wrap content in `uniform_list` / `ScrollableElement::overflow_y_scrollbar` |
| `truncate`          | `.truncate()`                       |
| `line-clamp-N`      | `.line_clamp(N)`                    |

Sources: `gpui_macros/src/styles.rs:129-156`. `Styled` does not expose a
generic `overflow_*_auto` — scrolling is opt-in via `uniform_list`,
`scrollable_div`, or `gpui_component::scroll::ScrollbarAxis`.

### 2.10 Position / inset

| Tailwind          | GPUI                  |
| ---               | ---                   |
| `relative`        | `.relative()`         |
| `absolute`        | `.absolute()`         |
| `fixed`           | n/a — use `.absolute()` on a fully-anchored parent |
| `top-0`           | `.top_0()`            |
| `left-2`          | `.left_2()`           |
| `right-1`         | `.right_1()`          |
| `bottom-4`        | `.bottom_4()`         |
| `inset-0`         | `.inset_0()`          |
| `inset-x-2`       | n/a — call `.left_2().right_2()` |
| `-top-1`          | `.top_neg_1()`        |

Source: `gpui_macros/src/styles.rs:852-890`. Note `inset` covers all four
sides (top + right + bottom + left); there is no `inset_x` / `inset_y`
shortcut.

### 2.11 Misc — cursor, opacity, shadow, visibility

| Tailwind         | GPUI                  |
| ---              | ---                   |
| `cursor-pointer` | `.cursor_pointer()`   |
| `cursor-default` | `.cursor_default()`   |
| `cursor-text`    | `.cursor_text()`      |
| `cursor-grab`    | `.cursor_grab()`      |
| `cursor-not-allowed` | `.cursor_not_allowed()` |
| `cursor-{n,s,e,w,ns,ew,ne,nw,…}-resize` | `.cursor_*_resize()` |
| `opacity-50`     | `.opacity(0.5)`       |
| `shadow-none`    | `.shadow_none()`      |
| `shadow-2xs`     | `.shadow_2xs()`       |
| `shadow-xs`      | `.shadow_xs()`        |
| `shadow-sm`      | `.shadow_sm()`        |
| `shadow-md`      | `.shadow_md()`        |
| `shadow-lg`      | `.shadow_lg()`        |
| `shadow-xl`      | `.shadow_xl()`        |
| `shadow-2xl`     | `.shadow_2xl()`       |
| `visible`        | `.visible()`          |
| `invisible`      | `.invisible()`        |
| `transition*`    | n/a — GPUI has no CSS transition; animate via `cx.spawn` + `Animation` |

Sources: `gpui_macros/src/styles.rs:159-333, 384-541, 50-70`.

---

## 3. Font + icon scale

### 3.1 Text builders

GPUI's `text_xs / text_sm / …` set the *font size* in rems
(`gpui/src/styled.rs:520-567`). The resulting pixel value is:

```
text_xs    -> rems(0.75)   -> 12 px @ rem=16
text_sm    -> rems(0.875)  -> 14 px
text_base  -> rems(1.0)    -> 16 px
text_lg    -> rems(1.125)  -> 18 px
text_xl    -> rems(1.25)   -> 20 px
text_2xl   -> rems(1.5)    -> 24 px
text_3xl   -> rems(1.875)  -> 30 px
```

For values that don't match the Tailwind ramp (e.g. the React
`SidebarParts.tsx:453` `text-[13px]` row title), use `.text_size(px(13.))`.

### 3.2 `Window::rem_size()`

`rem_size` defaults to `16 px` (`gpui/src/window.rs:1585`). Title-bar
height uses the formula `(1.75 * rem_size).max(px(34.))` — see
[`zed-title-bar-analysis.md`](./zed-title-bar-analysis.md), §2. If you ever
override `rem_size`, every `_N` builder rescales automatically because the
codegen emits `rems(…)`, not `px(…)`.

### 3.3 Icon sizes (`gpui-component`)

`Size` enum + `IconSize` mapping (gpui-component
`crates/ui/src/styled.rs:174-323`):

| `Size`     | label  | size_with()  | input_h() |
| ---        | ---    | ---          | ---       |
| `XSmall`   | `xs`   | `size_4()` = 16 px | `h_5()` = 20 px |
| `Small`    | `sm`   | `size_5()` = 20 px | `h_6()` = 24 px |
| `Medium`   | `md`   | `size_8()` = 32 px | `h_8()` = 32 px |
| `Large`    | `lg`   | `size_11()` = 44 px| `h_11()` = 44 px|

Note: `Size::XSmall` for **icons** in Zed (`IconSize::XSmall`) is `12 px`,
`IconSize::Small` is `14 px` — different from the gpui-component `Size`
above. See [`zed-title-bar-analysis.md`](./zed-title-bar-analysis.md) §2.
gpui-component's `Icon` widget defaults to `Size::Medium` and accepts
`with_size(Size::Size(px(14.)))` for custom values.

---

## 4. Theme token map

React shadcn aliases (`src/index.css:127-156` light, `:279-306` dark) →
gpui-component `ThemeColor`
(`/Users/konstantin/.cargo/git/checkouts/gpui-component-95ce574d8a0da8b8/a5268cd/crates/ui/src/theme/theme_color.rs:11-244`).
Accessed as `cx.theme().<field>` via the `ActiveTheme` extension.

### 4.1 Surfaces / text / borders

| React `--var`               | GPUI `theme.*`            | Semantic                            |
| ---                         | ---                       | ---                                 |
| `--background`              | `background`              | App background                      |
| `--foreground`              | `foreground`              | Default body text                   |
| `--card`                    | `tiles` (closest; see TODO) | Card surface (no perfect match)   |
| `--card-foreground`         | `foreground`              | Card text                           |
| `--popover`                 | `popover`                 | Popover surface                     |
| `--popover-foreground`      | `popover_foreground`      | Popover text                        |
| `--muted`                   | `muted`                   | Muted surface (skeletons, switches) |
| `--muted-foreground`        | `muted_foreground`        | Secondary/disabled text             |
| `--border`                  | `border`                  | Default border                      |
| `--input`                   | `input`                   | Input border                        |
| `--ring`                    | `ring`                    | Focus ring                          |

### 4.2 Brand / state

| React `--var`               | GPUI `theme.*`            | Semantic                            |
| ---                         | ---                       | ---                                 |
| `--primary`                 | `primary`                 | Brand fill (`--accent-blue`)        |
| `--primary-foreground`      | `primary_foreground`      | Text on primary                     |
| `--secondary`               | `secondary`               | Quiet button fill                   |
| `--secondary-foreground`    | `secondary_foreground`    | Text on secondary                   |
| `--accent`                  | `accent`                  | Hover / accent surface              |
| `--accent-foreground`       | `accent_foreground`       | Text on accent                      |
| `--destructive`             | `danger`                  | Destructive fill                    |
| `--destructive-foreground`  | `danger_foreground`       | Text on destructive                 |
| `--state-selected`          | `list_active`             | Selected row fill (pale-blue)       |
| `--state-hover-subtle`      | `list_hover`              | Hover row fill                      |
| `--state-hover`             | `accent` / `secondary_hover` | General hover (closest match — no exact equivalent) |
| `--state-focus-ring`        | `ring`                    | Focus outline                       |
| `--state-drag-target`       | `drop_target`             | Drag-over surface                   |
| `--state-disabled`          | `muted` (closest)         | Disabled surface                    |

### 4.3 Sidebar / chrome

| React `--var`               | GPUI `theme.*`            | Semantic                            |
| ---                         | ---                       | ---                                 |
| `--sidebar`                 | `sidebar`                 | Sidebar background                  |
| `--sidebar-foreground`      | `sidebar_foreground`      | Sidebar text                        |
| `--sidebar-primary`         | `sidebar_primary`         | Sidebar brand fill                  |
| `--sidebar-primary-foreground` | `sidebar_primary_foreground` | Text on sidebar brand fill      |
| `--sidebar-accent`          | `sidebar_accent`          | Sidebar hover/selected fill         |
| `--sidebar-accent-foreground` | `sidebar_accent_foreground` | Text on sidebar accent          |
| `--sidebar-border`          | `sidebar_border`          | Sidebar divider                     |
| `--sidebar-ring`            | `ring`                    | Sidebar focus outline               |
| n/a                         | `title_bar`               | Title-bar background (Zed-only concept) |
| n/a                         | `title_bar_border`        | Title-bar bottom rule               |

### 4.4 Accents / feedback (no direct theme fields — use `cx.theme().<n>` where present, else hard-coded literals)

| React `--var`               | GPUI `theme.*`            | Notes                               |
| ---                         | ---                       | ---                                 |
| `--accent-blue`             | `primary` (aliased) / `blue` | shadcn maps `--primary` to `--accent-blue` (`src/index.css:135`). `theme.blue` is the *base* swatch, not the dark-mode-aware accent. |
| `--accent-green`            | `success` / `green`       | `success` is brand-aware; `green` is the base swatch. |
| `--accent-red`              | `danger` / `red`          | Same pattern as above.              |
| `--accent-orange`           | n/a                       | No direct field — use a literal `hsla(...)` or extend `ThemeColor`. |
| `--accent-purple`           | n/a                       | (Same.) Use literal.                |
| `--accent-yellow`           | `warning` / `yellow`      |                                     |
| `--accent-teal`             | `cyan` (closest)          | Not a perfect match.                |
| `--accent-pink`             | `magenta` (closest)       | Not a perfect match.                |
| `--accent-gray`             | `muted_foreground`        |                                     |
| `--feedback-info-text`      | `info_foreground`         |                                     |
| `--feedback-info-bg`        | `info`                    |                                     |
| `--feedback-success-text`   | `success_foreground`      |                                     |
| `--feedback-success-bg`     | `success`                 |                                     |
| `--feedback-warning-text`   | `warning_foreground`      |                                     |
| `--feedback-warning-bg`     | `warning`                 |                                     |
| `--feedback-error-text`     | `danger_foreground`       |                                     |
| `--feedback-error-bg`       | `danger`                  |                                     |

### 4.5 Scrollbar / chart / table

| React `--var`               | GPUI `theme.*`            |
| ---                         | ---                       |
| n/a (browser-native scroll) | `scrollbar`, `scrollbar_thumb`, `scrollbar_thumb_hover` |
| n/a                         | `chart_1` … `chart_5`, `chart_bullish`, `chart_bearish` |
| n/a                         | `table`, `table_active`, `table_hover`, `table_head`, `table_head_foreground`, `table_row_border`, `table_even`, `table_foot` |
| n/a                         | `tab`, `tab_active`, `tab_active_foreground`, `tab_bar`, `tab_bar_segmented`, `tab_foreground` |

### 4.6 Gaps (no direct field in `ThemeColor`)

- `--state-active` — TODO: closest is `list_active` (used in sidebar) or
  `secondary_active`. No 1:1 field.
- `--surface-input` (filled input bg, distinct from `input` border) — no
  direct field in `ThemeColor`; if Tolaria's chrome needs the filled
  surface, hard-code from `cx.theme().background` or extend
  `gpui-component`'s schema.
- `--surface-overlay` (modal scrim) — `theme.overlay`.
- `--surface-button` — no direct field. Use `secondary` (closest).
- `--surface-editor` — no direct field. Use `background`.

Tolaria's own `Palette` struct
(`crates/sidebar_panel/src/lib.rs:625-668`) already crystallises this
mapping for the sidebar — copy that pattern when porting another pane.

---

## 5. Workarounds and gotchas

- **Per-side border colour (`border-l-blue`, `border-t-red`, …).** GPUI
  `Styled::border_color` sets one colour for all four sides — there is no
  `.border_l_color(…)`. Workaround: render a leading flex sibling with the
  coloured background and `self_stretch()`:

  ```rust
  // From crates/note_list_pane/src/lib.rs:851-868
  let accent_strip = div()
      .flex_shrink_0()
      .w(px(4.0))           // 4-pt strip — was border-l-4 in React
      .self_stretch()
      .bg(accent_color);
  h_flex()
      .items_stretch()      // CRITICAL: stretch so the strip fills row height
      .child(accent_strip)
      .child(content);
  ```

- **`truncate` (single-line ellipsis).** GPUI has `.truncate()`
  (`gpui/src/styled.rs:131`). Requires the parent to constrain width —
  often paired with `.min_w_0()` on the truncated child and `.flex_1()` on
  its container.

- **`line-clamp-N`.** Use `.line_clamp(N)`
  (`gpui/src/styled.rs:137`). Example from
  `crates/note_list_pane/src/lib.rs:836`: `.line_clamp(2)`.

- **`overflow-y-auto` on a flex column.** GPUI has no styled
  `.overflow_y_auto()` builder. For long vertical content use one of:
  - `uniform_list(…)` — the preferred pattern; built-in scrollbar +
    virtualisation.
  - `gpui_component::scroll::scrollable_div(…)` /
    `.overflow_y_scrollbar()` — for non-uniform content.

- **`min-w-0` on `flex-1` children.** Required so `truncate` actually
  truncates. Same rule as CSS flexbox: the default `min-width` of a flex
  child is `auto`, not `0`. Forgetting this is the #1 cause of "title
  shoves the trailing pill off the row" in `note_list_pane`. See
  `crates/note_list_pane/src/lib.rs:820-826`.

- **`gap` on non-flex parents.** Tailwind's `gap-N` is a no-op outside
  flex/grid; GPUI follows the same rule. Always pair with `.flex()` /
  `h_flex()` / `v_flex()`.

- **`fixed` positioning.** No GPUI builder. Anchor an `.absolute()` child
  inside a window-sized `.relative()` root (e.g. the workspace root).

- **CSS transitions / `transition-colors`.** Not available as a builder.
  Hover/selection swaps happen synchronously by re-rendering the element
  with the new colour. For real animations use
  `gpui::Animation` + `cx.spawn`.

- **`text-[13px]` and other off-ramp values.** Use `.text_size(px(13.))`
  — see `crates/sidebar_panel/src/lib.rs` (multiple call sites use
  `text_xs` then `.text_size(px(...))` where needed). Same applies to
  off-ramp paddings: `.p(px(11.0))`, `.gap(px(7.0))`, etc.

- **`inset-x-N` / `inset-y-N`.** Not generated by the macro. Write
  `.left_N().right_N()` / `.top_N().bottom_N()` explicitly.

- **`mx-auto` for centering.** Margin allows `auto`, padding does not
  (`box_style_suffixes()` only emits the `auto` variant when
  `auto_allowed = true` — `gpui_macros/src/styles.rs:601, 617`).

- **`bg-*` color uses `cx.theme()` directly.** Tailwind's `bg-card` is
  `.bg(cx.theme().tiles)` (or whatever the closest mapping is — see §4).
  Tolaria's pattern: hoist a `Palette` struct at render entry, then pass
  `&Palette` into row builders — see `Palette::from` at
  `crates/sidebar_panel/src/lib.rs:652-667`.

- **Negative spacing.** Use the `_neg_N` suffix
  (`.mt_neg_1()`, `.top_neg_2()`). Generated for *every* prefix that
  accepts non-`auto` suffixes — see `generate_predefined_setter` at
  `gpui_macros/src/styles.rs:680-712`.

---

## 6. Builder-name conventions

- **Numeric suffix** ⇒ quarter-rems: `_N` = `rems(N / 4)` (so `_4` = 1 rem
  = 16 px @ default). Fractional suffixes are `_0p5`, `_1p5`, `_2p5`,
  `_3p5` — that's the **complete** set; there is no `_4p5` or higher
  fractional rung.
- **`_px` suffix** ⇒ literal 1 px (`.h_px()`, `.w_px()`, `.border_px(...)`
  not generated — use `.border_1()`).
- **`.p(...)`, `.gap(...)`, `.h(...)` etc.** (no suffix) ⇒ custom length;
  accept any `Into<DefiniteLength>` (e.g. `px(13.0)`, `rems(0.875)`,
  `relative(0.5)`). Generated by
  `generate_custom_value_setter` (`gpui_macros/src/styles.rs:714-746`).
- **Builder name = Tailwind utility with `-` replaced by `_`**:
  `gap-x-3` → `.gap_x_3()`, `min-h-0` → `.min_h_0()`,
  `rounded-tl-md` → `.rounded_tl_md()`,
  `border-l-2` → `.border_l_2()`.
- **`h_flex()` / `v_flex()`** are convenience constructors from
  `gpui_component::styled` — `h_flex() == div().flex().flex_row().items_center()`,
  `v_flex() == div().flex().flex_col()`.
- **`.when(cond, |this| this.foo())`** is GPUI's conditional builder
  shortcut (idiomatic Rust analogue of Tailwind's `cn(cond && 'foo')`).
- **`.refine_style(&style)`** lets you apply a pre-built `StyleRefinement`
  (`gpui_component::styled::StyledExt::refine_style`).

---

## 7. Cross-references

- **Title-bar pixel dimensions** (height formula, traffic-light inset,
  fullscreen vs windowed padding) — [`zed-title-bar-analysis.md`](./zed-title-bar-analysis.md).
- **Tolaria GPUI Palette pattern** —
  `crates/sidebar_panel/src/lib.rs:625-668`.
- **Working example of all of §5's workarounds in one file** —
  `crates/note_list_pane/src/lib.rs:820-898` (`flex_1 + min_w_0 + truncate
  + line_clamp + accent-strip-as-flex-sibling`).
- **Canonical GPUI generated-builder source** —
  `/Users/konstantin/.cargo/git/checkouts/zed-a70e2ad075855582/8ca194d/crates/gpui_macros/src/styles.rs`
  (proc-macro that emits every `.p_*()` / `.gap_*()` / `.border_*()` /
  `.rounded_*()` method).
- **Canonical GPUI hand-written `Styled` methods** (flex, items, justify,
  text, truncate, line_clamp, cursor) —
  `/Users/konstantin/.cargo/git/checkouts/zed-a70e2ad075855582/8ca194d/crates/gpui/src/styled.rs`.
- **gpui-component extensions** (`h_flex`, `v_flex`, `font_*`,
  `popover_style`, `Size`, `IconSize`, `Sizable`, `Selectable`) —
  `/Users/konstantin/.cargo/git/checkouts/gpui-component-95ce574d8a0da8b8/a5268cd/crates/ui/src/styled.rs`.
- **gpui-component theme schema** —
  `/Users/konstantin/.cargo/git/checkouts/gpui-component-95ce574d8a0da8b8/a5268cd/crates/ui/src/theme/theme_color.rs:11-244`.
- **React side — Tailwind v4 + shadcn vars** — `src/index.css:1-587`.
- **React `NoteListLayout` reference (rows, headers)** —
  `src/components/note-list/NoteListLayout.tsx`.

---

## TODOs / unknowns

- The mapping for `--card` → GPUI is fuzzy. `ThemeColor` has no `card`
  field; the closest match is `tiles`. If a future ADR formalises a card
  surface in gpui-component, update §4.1.
- `--state-hover` (general hover, not list hover) has no exact GPUI field.
  Today the sidebar uses `list_hover`; for non-list rows we may need to
  hard-code the value or extend `ThemeColor`.
- Accent palette colours that are *not* feedback-shaped (orange, purple,
  pink, teal as **independent accents**) have no direct theme fields —
  pick the closest base swatch (`yellow`, `magenta`, `cyan`) or hard-code a
  literal. A follow-up could add `ThemeColor::accent_orange` etc.
- `IconSize::XSmall == 12 px` / `IconSize::Small == 14 px` (per Zed) vs
  gpui-component's `Size::XSmall.size_with() == 16 px`. The two crates'
  Size enums are *different ramps* — confirm at use-site which crate's
  `Size` is in scope before assuming a pixel value.
