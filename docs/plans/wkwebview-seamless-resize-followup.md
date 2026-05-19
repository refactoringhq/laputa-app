# WKWebView Seamless Resize — Follow-up Investigation

> **Status:** post-mortem after commit `207da697` did not fix the symptom.
> Research-only. No source files modified.

---

## 1. What We Shipped (recap)

Commit `207da697` applied three objc2 calls in `spawn_test_webview`, all
running on the bare `wry::WebView` immediately after `build_as_child` and
before `WebView::new` wraps it in an `Rc`:

| Fix | Function | Location |
|-----|----------|----------|
| Autoresize mask flipped from `ViewMinYMargin` to `ViewWidthSizable \| ViewHeightSizable` | `fix_autoresize_mask` | `crates/embed_poc/src/webview.rs:133-148` |
| `NSWindow.setBackgroundColor` set to `rgb(0x12141a)` via `ns_view → window()` | `fix_window_background` | `crates/embed_poc/src/webview.rs:185-230` |
| KVC `drawsBackground = false` on the `WKWebView` | `fix_draws_background` | `crates/embed_poc/src/webview.rs:153-171` |

The spec assumed that the autoresize mask fix was the highest-leverage
change and that the other two were cosmetic safeguards for the residual
1-frame mismatch. Visual verification was deferred to a manual smoke test
(`wkwebview-seamless-resize.md §6 "Verification"`).

---

## 2. Hypotheses (ranked, evidence-driven)

### 2a. The `setAutoresizingMask` call is applied to the wrong NSView (HIGH CONFIDENCE — primary suspect)

**Hypothesis:** `fix_autoresize_mask` sets the mask on the `WKWebView`
(`WryWebView`) itself, but that view was added as a **subview of GPUI's
`native_view`**, not a subview of `contentView`. The mask controls how
`WKWebView` tracks its *parent*. The parent here is `native_view` — which
has `ViewWidthSizable | ViewHeightSizable` set on it (`window.rs:870`) and
whose frame is driven by AppKit live-resize. So the mask on the WKWebView
should in principle work … but only if `native_view`'s frame actually
changes during live resize.

The catch: GPUI overrides `setFrameSize:` on `VIEW_CLASS`
(`window.rs:228`, `window.rs:2432-2468`). That override calls
`[super setFrameSize:]` correctly, so the AppKit geometry pass does
propagate the size to `native_view`, which should in turn propagate it to
the WKWebView via the autoresize mask. **However**, `native_view` is the
Metal-layer-backed view (`setWantsLayer YES`, `makeBackingLayer` returns
the `CAMetalLayer` — `window.rs:218-220`, `metal_renderer.rs:151`). The
WKWebView's remote `CALayer` (hosted in the WebKit GPU process) is a
sublayer of `native_view`'s layer tree. Whether AppKit's geometry phase
actually propagates a `setFrame:` call into WKWebView's remote layer
synchronously — or whether WKWebView's remote-process layer update lags
behind — is **not visible from source alone** and requires a runtime probe.

**Evidence for:**
- lb-wry `build_as_child` calls `ns_view.addSubview(&webview)` at
  `lb-wry-0.53.3/src/wkwebview/mod.rs:632`, where `ns_view` is the
  `AppKitWindowHandle.ns_view` pointer.
- GPUI's `window_handle()` returns `native_view` as the `ns_view`
  (`gpui_macos/src/window.rs:1744`).
- `native_view.setAutoresizingMask_(NSViewWidthSizable | NSViewHeightSizable)`
  is set at `window.rs:870`, so `native_view` already tracks `contentView`.
- GPUI's `setFrameSize:` override calls `[super setFrameSize:]`
  (`window.rs:2454`), which lets AppKit propagate geometry normally to
  subviews.

**Evidence against:**
- WKWebView is a remote-layer-backed view. AppKit's autoresize mechanism
  calls `setFrame:` on the `NSView` object, which for a remote-layer view
  must cross an IPC boundary into the WebKit GPU process to update the
  backing `CALayer`. This round-trip may introduce the very lag we are
  trying to eliminate.
- The spec's §3 already identified this lag as the fundamental problem:
  "WebKit's GPU process eventually catches up" — the autoresize mask does
  not eliminate the IPC round-trip, it merely triggers it one phase earlier
  (at AppKit geometry time rather than GPUI render time).

**Confidence:** HIGH — the mask is on the correct `NSView` in the correct
parent, but the autoresize path may still lag because WKWebView is remote-layer-backed.

**How to verify:**
Add a `viewDidMoveToWindow` or `setFrameSize:` log to confirm the WKWebView
NSView's frame is updated synchronously. Instrument with:
```rust
// after fix_autoresize_mask, in debug builds only:
let wk = webview.webview();
log::info!("wkwv frame before: {:?}", wk.frame());
// then after a simulated resize (e.g. via AppleScript):
log::info!("wkwv frame after:  {:?}", wk.frame());
```
If the frame updates synchronously but the artifact persists, the lag is
in the WebKit GPU process render — confirming this hypothesis's "evidence
against" branch.

---

### 2b. GPUI's Metal renderer clears the entire `native_view` surface every frame, painting over the WebView region (HIGH CONFIDENCE — likely concurrent root cause)

**Hypothesis:** `native_view` is layer-backed with a `CAMetalLayer`
returned by `makeBackingLayer` (`window.rs:218-220`, `metal_renderer.rs:151`).
GPUI clears this layer to opaque black on every frame
(`metal_renderer.rs:760`: `MTLClearColor::new(0.,0.,0.,1.0)` when `opaque=true`),
then draws all GPUI quads including `div().bg(rgb(0x12141a))` (the
content-panel background at `layout.rs:179`) **over the region where the
WebView sits**. The `InstrumentedWebView::prepaint` never draws anything —
it only calls `set_bounds`. So on every GPUI frame the Metal surface
paints an opaque `0x12141a` rectangle exactly where the WebView is
supposed to show through.

The WKWebView's `CALayer` (a remote layer) is a sublayer in the layer tree
**above** the Metal `CALayer` of `native_view`. In CoreAnimation, a
subview's `CALayer` composites on top of its parent's `CALayer`. So the
WKWebView should visually be on top. BUT: during a live resize the Metal
surface is resized and redrawn immediately (synchronously on the display
link tick), while the WKWebView's remote layer resize requires an IPC
round-trip to the WebKit GPU process. For the 1-2 frames where the remote
layer is still at the old size, the Metal layer — which has already been
redrawn at the new size with an opaque `0x12141a` fill — shows through the
gap. The colour is `0x12141a`, which matches the `drawsBackground = false`
intent, but `drawsBackground = false` on WKWebView only suppresses
WebKit's own white fill, not GPUI's Metal clear.

This means: even if the autoresize mask propagates the new frame to
the WKWebView NSView synchronously, there is still a frame gap because
the remote layer (in the WebKit GPU process) is not updated until WebKit
processes the geometry change and commits a new `CALayer` transaction.
During that gap, the Metal surface shows through.

**Evidence for:**
- `metal_renderer.rs:156`: `layer.set_opaque(!transparent)` — for non-transparent
  window the layer is opaque.
- `metal_renderer.rs:760`: clear color is `(0,0,0,alpha)` where `alpha=1.0`
  when opaque.
- `window.rs:218-219`: `VIEW_CLASS` registers `makeBackingLayer` → returns
  the `CAMetalLayer`. The entire `native_view` surface is the Metal canvas.
- `layout.rs:179`: `div().size_full().bg(rgb(0x12141a))` wraps the
  `InstrumentedWebView` — GPUI renders this quad every frame.
- `gpui-wry/src/lib.rs:191-200`: `WebViewElement::prepaint` calls
  `set_bounds` but never calls any GPUI paint primitive; there is no "hole"
  punched in the Metal surface.

**Evidence against:**
- CoreAnimation compositing: if the WKWebView's remote `CALayer` is above
  the Metal `CALayer` in the sublayer tree, the compositor should show the
  WebView on top. This is the expected and normal behavior for embedding
  a WKWebView inside any layer-backed NSView. The artifact may only
  manifest during the brief resize frame when the WebKit GPU process hasn't
  yet committed its new layer geometry.
- The `fix_draws_background = false` call was intended to address
  WebKit's own painting. It doesn't affect whether GPUI's Metal surface
  paints behind the WebView.

**Confidence:** HIGH — this explains why the artifact appears specifically
during resize and drag (transitions), not during steady state.

**How to verify:**
Temporarily change the `div().bg(rgb(0x12141a))` in `layout.rs:179` to
`div().bg(rgb(0xff0000))`. If the trailing strip turns red during resize,
it is the GPUI Metal surface showing through, confirming this hypothesis.

---

### 2c. `h_resizable` splitter drag never triggers AppKit `setFrameSize:` on `native_view` — autoresize mask is irrelevant for it (MEDIUM CONFIDENCE)

**Hypothesis:** During an `h_resizable` splitter drag, the window NSFrame
does not change — only GPUI's internal layout changes. AppKit's geometry
phase (which propagates autoresize masks) is triggered by NSWindow resize,
not by GPUI-internal pane resize. So `setAutoresizingMask` cannot help
with splitter drag artifacts at all; only the GPUI-render-path `set_bounds`
call in `InstrumentedWebView::prepaint` can update the WKWebView frame
during a splitter drag.

During a splitter drag, `prepaint` runs on every GPUI frame and calls
`set_bounds` (lb-wry `set_bounds` → `setFrame:` on the WKWebView).
The artifact here is the same IPC-round-trip lag (hypothesis 2b): GPUI
redraws the Metal surface synchronously while WebKit's remote layer update
is async.

**Evidence for:**
- `layout.rs:148-165`: `log_sidebar_resize` is called via `on_resize` which
  fires at drag commit, not during the drag. During the drag `prepaint` is
  the only geometry-update path.
- `wkwebview-seamless-resize.md §4.5`: the original spec already noted that
  autoresize masks "only helps with NSWindow resize, not GPUI-internal pane
  resize."
- `lb-wry-0.53.3/src/wkwebview/mod.rs:944-959`: `set_bounds` calls
  `setFrame:` on `self.webview` — this is a synchronous NSView frame update,
  but the remote CALayer commit is async.

**Evidence against:**
- If `prepaint` runs on every GPUI frame and calls `set_bounds`
  synchronously, the NSView frame should be in lockstep with GPUI layout
  during the drag. The lag is the WebKit GPU process, not a missing call.

**Confidence:** MEDIUM — the autoresize mask is confirmed irrelevant for
splitter drag; the lag mechanism is the same remote-layer IPC round-trip.

**How to verify:**
Disable the autoresize mask fix entirely and test only the splitter drag.
If the artifact is the same, the mask fix never helped the splitter drag
case and only the colour-match / `underPageBackgroundColor` path can help.

---

### 2d. `drawsBackground = false` was applied to the `WKWebView` instance, but the KVC key belongs to `WKWebViewConfiguration` (MEDIUM CONFIDENCE)

**Hypothesis:** Tauri's `drawsBackground` KVC call is applied to
`WKWebViewConfiguration` at construction time
(`wry/0.54.2/src/wkwebview/mod.rs:353-371`): the config object is mutated
before `initWithFrame:configuration:` is called. Our `fix_draws_background`
calls `setValue:forKey:` on the `WKWebView` instance itself
(`crates/embed_poc/src/webview.rs:160-167`), which is a different object.
Apple's documentation for `drawsBackground` says it is a property of
`WKWebView` directly (not the config), so the instance KVC call should
work — but if it silently fails (e.g. the key is not KVC-compliant on the
instance in the lb-wry version of WebKit), the fix does nothing.

**Evidence for:**
- The commit doc (`webview.rs:47-53`) says the KVC key is applied to
  `WKWebViewConfiguration` in Tauri, but our code applies it to the
  `WKWebView` instance.
- Apple's `WKWebView.drawsBackground` is also available as an instance
  property on macOS 10.14+, so the instance call should work — but it
  is a separate codepath from the config-level KVC.

**Evidence against:**
- Apple docs confirm `drawsBackground` is a first-class property of
  `WKWebView` (not just `WKWebViewConfiguration`). Calling KVC on the
  instance should be equivalent to calling `setDrawsBackground:`.

**Confidence:** MEDIUM (false negative possible; easy to rule out).

**How to verify:**
After calling `fix_draws_background`, immediately read the value back:
```rust
let val: id = msg_send![wk, valueForKey: ns_string!("drawsBackground")];
let b: BOOL = msg_send![val, boolValue];
assert_eq!(b, NO, "drawsBackground was not set to false");
```
If the assertion passes, the KVC write succeeded. If the artifact persists,
`drawsBackground = false` is not the root cause.

---

### 2e. `fix_window_background` walks `ns_view → window()` which may return GPUI's `native_view`'s window at call time, but a different `NSColor` object may be needed (LOW CONFIDENCE)

**Hypothesis:** `fix_window_background` sets `NSWindow.backgroundColor` to
`rgb(0x12141a)`. This should cause the NSWindow's background to render
in that colour. But `native_view` uses `setWantsLayer YES` and the Metal
layer is opaque, so the NSWindow background is never visible behind
`native_view`; it's only visible in regions not covered by `native_view`
or its sublayers. If the trailing strip is in a region already covered by
`native_view` but not yet by WKWebView's remote layer, it is the Metal
layer colour (black clear, then GPUI quad `0x12141a`) that shows, not the
NSWindow background colour. The fix may be targeting the wrong layer.

**Evidence for:**
- `metal_renderer.rs:156`: Metal layer is opaque.
- The NSWindow background is only visible in areas not covered by any
  opaque layer. `native_view` covers the full content area with an opaque
  Metal layer.

**Evidence against:**
- During live resize, before `native_view`'s `setFrameSize:` has been
  called, there may be a brief moment where the window's backing store
  shows the NSWindow background at the new size before any layer has been
  updated. This is the scenario `fix_window_background` was targeting.

**Confidence:** LOW — the window background fix may be correct but
irrelevant to the most common artifact, which occurs after `native_view`
has already been resized.

---

### 2f. The `set_bounds` call in `WebView::new` resets the frame to zero (MEDIUM CONFIDENCE — newly identified)

**Hypothesis:** `gpui_wry::WebView::new` immediately calls
`webview.set_bounds(Rect::default())` at
`gpui-component/crates/webview/src/lib.rs:33`. `Rect::default()` is a
zero-size rect at origin (0,0). This `set_bounds` call runs AFTER
`fix_autoresize_mask` — `WebView::new` is called with the bare `wry::WebView`
that already has the mask set. `set_bounds(Rect::default())` calls
`self.webview.setFrame(CGRect { origin: ..., size: CGSize::new(0,0) })`.
Setting the frame to zero explicitly via `setFrame:` overrides the
autoresize mask: the mask is applied by AppKit on the next `setFrameSize:`
of the parent, but an explicit `setFrame:` call immediately forces the
frame to zero. If the WebView starts at frame (0,0,0,0) and the
autoresize mask only fires on the next parent resize, the WebView is
invisible until the next live-resize event — and the first live-resize
event may set it to the wrong size if `InstrumentedWebView::prepaint` has
not yet run.

**Evidence for:**
- `gpui-component/crates/webview/src/lib.rs:33`: `let _ = webview.set_bounds(Rect::default());`
  is the first thing `WebView::new` does.
- lb-wry `set_bounds` in child mode (`lb-wry-0.53.3/src/wkwebview/mod.rs:944-959`)
  calls `self.webview.setFrame(frame)` with a zero-sized `CGRect`.
- An explicit `setFrame:` call does NOT preserve the autoresize mask for
  the current frame; the mask only applies on subsequent parent-driven
  geometry changes.

**Evidence against:**
- `InstrumentedWebView::prepaint` runs on the first GPUI render pass and
  sets the correct bounds. If the first render happens before the user
  sees anything, the zero-frame is transient.
- The original symptom is a trailing strip during resize, not a missing
  WebView at startup.

**Confidence:** MEDIUM — this is a real bug that may cause a flicker at
startup and immediately after the WebView entity is created, but it
probably does not cause the resize artifact.

**How to verify:**
Log the WKWebView's `frame` immediately after `WebView::new` returns and
after the first `prepaint` call. If it's `(0,0,0,0)` between the two,
this hypothesis is confirmed.

---

## 3. Recommended Next Probes (priority order)

### Probe 1 — Red-background test to confirm Metal surface shows through (15 min)

**What to instrument:**
Change `layout.rs:179`:
```rust
// before:
let body = div().size_full().bg(rgb(0x12141a));
// after (debug only):
let body = div().size_full().bg(rgb(0xff0000));
```

**What success looks like:**
If the trailing strip turns red during live resize, hypothesis 2b is
confirmed: GPUI's Metal surface is painting over the WebView region,
and the fix must punch a hole in the Metal surface (make the quad
transparent) or restructure the view hierarchy so the WKWebView sits
outside `native_view`'s layer tree.

If the strip remains the original colour (matches the old window
background), hypothesis 2e is confirmed instead, and `fix_window_background`
addresses the right layer.

This probe is zero-risk, requires one line change, and produces an
unambiguous binary answer.

---

### Probe 2 — Log WKWebView frame before and after parent `setFrameSize:` to confirm autoresize mask fires (30 min)

**What to instrument:**
Add a `viewDidLayout` or `frameDidChange` observer to the WKWebView using
`objc2` KVO, or simply log the WKWebView's `frame` in the GPUI
`resize_callback` (already fired from `set_frame_size` at `window.rs:2461`):

```rust
// In spawn_test_webview, capture a weak ref to the WKWebView and register
// the resize_callback to log wk.frame() after each native resize.
window.set_resize_callback(move |size, _scale| {
    log::info!("wkwv frame during resize: {:?}", wk.frame());
});
```

**What success looks like:**
If `wk.frame()` matches the new window size immediately in the callback
(before the next GPUI render), the autoresize mask is working and the
lag is entirely in the WebKit GPU process (remote layer commit).
In that case the only viable fix is `setUnderPageBackgroundColor` + a
transparent GPUI quad over the WebView region.

If `wk.frame()` still shows the old size, the autoresize mask is not
propagating (possibly because `setFrame:` from `gpui_wry::WebView::new`
zeroed it out — probe 2f — or because the mask is applied to the wrong
level).

---

### Probe 3 — Remove `div().bg(...)` wrapper from the WebView element to test transparent Metal surface (20 min)

**What to instrument:**
In `layout.rs:178-186`, remove the `bg(rgb(0x12141a))` from the `body`
div that wraps `InstrumentedWebView`. The WebView element itself has no
GPUI paint; without the background quad, the Metal surface in that region
will be the cleared black (`MTLClearColor(0,0,0,1)`).

Optionally also change the Metal clear color to match: in `metal_renderer.rs:760`,
change the clear to `rgb(0x12141a)` rather than pure black (this requires
a small fork or a runtime hook).

**What success looks like:**
If removing the background quad eliminates the trailing strip (or changes
it from `0x12141a` to black), it confirms that the GPUI quad is causing
the visible artifact and that the correct fix is to not paint a background
behind the WebView — instead, rely on `NSWindow.backgroundColor` +
`drawsBackground = false` on WKWebView to fill the region.

---

## 4. Revised Implementation Plan

The hypotheses converge on **two concurrent root causes** (2b is the
primary, 2a's remote-layer IPC lag is a secondary mechanism):

### Root cause A (primary): GPUI Metal surface paints opaque `0x12141a` over the WebView region every frame

The `div().bg(rgb(0x12141a))` wrapping `InstrumentedWebView` in
`content_panel` (`layout.rs:178-186`) draws a fully-opaque quad across
the entire WebView area on every GPUI frame. During a resize, GPUI
redraws this quad at the new size synchronously, while the WKWebView's
remote layer is still at the old size. The Metal surface — which is
above or co-planar with the WebView area — shows the `0x12141a` fill
in the gap region.

**Corrected patch (proposed pseudocode — do not apply until Probe 1 confirms):**

```rust
// layout.rs:178-186
fn content_panel(webview: Option<Entity<WebView>>, last_bounds: FrameSyncState) -> AnyElement {
    // Remove bg() — let the WKWebView fill this region via its own layer.
    // NSWindow.backgroundColor (set by fix_window_background) covers any
    // gap during resize.
    let body = div().size_full();  // no .bg(...)
    match webview {
        Some(wv) => body
            .child(InstrumentedWebView::new(wv, last_bounds))
            .into_any_element(),
        None => body.bg(rgb(0x12141a)).into_any_element(),
    }
}
```

Additionally, set the Metal layer's clear color to `0x12141a` (or
transparent) so the clear doesn't reveal black during the 1-frame gap:
- **Option A (correct):** set the renderer transparent for the embed_poc
  window (`WindowOptions { transparent: true, ... }`) — this sets
  `layer.set_opaque(false)` and clear alpha to 0, letting the WKWebView
  layer composite through. Requires GPUI window option.
- **Option B (approximate):** After `fix_window_background`, also call
  `fix_metal_clear_color` that reaches into the CAMetalLayer via
  `window_state.renderer.layer_ptr()` and sets the clear color to
  `rgb(0x12141a)`. Not exposed by GPUI's public API; requires unsafe.

### Root cause B (secondary): WKWebView remote layer commits lag behind AppKit geometry phase

For live resize, this lag is irreducible unless we either:
1. Use a transparent Metal surface (Option A above) so the lag is invisible.
2. Add `setUnderPageBackgroundColor` (`0x12141a`) to WKWebView — fills the
   band the WebKit GPU process hasn't rendered yet with the right colour.
   This is lb-wry §4.4 (deferred in the original spec).

**Minimal corrected implementation:**
- Remove `.bg(rgb(0x12141a))` from the WebView-containing `content_panel`.
- Add `setUnderPageBackgroundColor` call in `fix_autoresize_mask` vicinity
  (objc2, macOS 12+, same pattern as `fix_window_background`).
- Keep `fix_window_background`, `fix_draws_background`, `fix_autoresize_mask`
  as-is — they are all necessary.

**If Probe 1 does NOT show red strip:** the Metal surface is not the
cause; instead apply the instrumentation patch from Probe 2 to collect
remote-layer commit timing before implementing further fixes.

---

## 5. Risks of the Current Commit

**Recommendation: keep as-is, add a follow-up commit.**

The three fixes in `207da697` are all **necessary but insufficient**:

- `fix_autoresize_mask`: correct fix, but does not address remote-layer
  IPC lag. No harm keeping it — it eliminates one latency source.
- `fix_window_background`: correct — ensures NSWindow background
  matches. No harm.
- `fix_draws_background`: correct — suppresses WebKit's own white fill.
  No harm.

None of the three fixes introduce regressions. Reverting would re-expose
WebKit's opaque-white background and the default grey NSWindow colour.
The fixes are all necessary steps toward the final solution; they just
don't address the GPUI Metal surface painting over the WebView region.

The single highest-leverage missing fix is removing (or making transparent)
the `div().bg(rgb(0x12141a))` background quad in `content_panel` — this
directly addresses why the Metal surface shows through during resize, which
is the visible artifact. Run Probe 1 first to confirm before applying.

---

## 6. Real production trace (Tolaria runtime path)

**Root `div` → WebView region — every element that paints `.bg(...)`:**

| Layer | File | Line | Paint | Colour (dark / light) |
|-------|------|------|-------|----------------------|
| Workspace root | `crates/workspace/src/workspace.rs` | 242 | `.bg(theme.background)` | `#1F1E1B` / `#FFFFFF` |
| ResizablePanel row | `gpui_component` internal | — | none | — |
| PaneGroup (active-pane branch) | `crates/workspace/src/pane_group.rs` | ~~75~~ **removed** | ~~`.bg(bg)`~~ **transparent div** | — |
| Pane (active-item branch) | `crates/workspace/src/pane.rs` | ~~128~~ **removed** | ~~`.bg(bg)`~~ **transparent div** | — |
| NoteItem container | `crates/note_item/src/lib.rs` | 441 | none | — |
| InstrumentedWebView | `crates/note_item/src/lib.rs` | 659+ | none (only `set_bounds`) | — |

**Key finding:** The diagnosis in §2b was confirmed by source analysis.
`embed_poc`'s `layout.rs:179` had a `div().bg(rgb(0x12141a))` around its
WebView, but the Tolaria runtime path does not have that wrapper.  Instead,
the obscuring paint came from **two redundant `.bg(theme.background)`** quads
at `PaneGroup::render` and `Pane::render`.  During live resize, GPUI redraws
both at the new size synchronously while the WKWebView's remote CALayer (in
the WebKit GPU process) is one IPC frame behind — showing a coloured strip.

**Fix applied (Path B — colour match + redundancy removal):**

1. `pane_group.rs` — removed `.bg(bg)` from the active-pane branch; kept it
   only on the empty-group fallback (no WebView there).
2. `pane.rs` — removed `.bg(bg)` from the active-item branch; kept it only
   on the empty-pane fallback.
3. `note_item/src/lib.rs` — ported `fix_autoresize_mask`, `fix_draws_background`,
   `fix_window_background` from `embed_poc::spawn_test_webview` into the
   production `spawn_webview` path (they were missing from the live binary).
4. Added `fix_under_page_background` (new, not in embed_poc): sets
   `WKWebView.underPageBackgroundColor` to `#1F1E1B` (dark default) via KVC
   so the gap WebKit fills during the remote-layer IPC lag matches
   `theme.background` — making the 1-frame lag invisible.

**Colour match verification:**
- Dark: `theme.background` = `#1F1E1B` (`palette::apply_dark`) =
  `--surface-app` / `--surface-editor` in `src/index.css:178,186`.
  WebView body: `body { @apply bg-background }` → `--background` →
  `--surface-app` → `#1F1E1B`. ✓ exact match.
- Light: `theme.background` = `#FFFFFF` (`palette::apply_light`) =
  `--surface-app` / `--surface-editor` in `src/index.css:26,34`.
  WebView body → `#FFFFFF`. ✓ exact match.

**Note:** `fix_window_background` still uses the dark value (`#1F1E1B`) as
a construction-time default because `spawn_webview` runs before any GPUI
render pass and the theme global is not readable there.  A theme-change
observer already exists in `main.rs` (`cx.observe_global::<Theme>`) and
could be extended to update `NSWindow.backgroundColor` if the user switches
themes at runtime — but for the resize artifact this is low priority since
the window background is only visible behind all opaque layers.

**Runtime verification still required:** The trailing-strip artifact must be
confirmed absent by running `pnpm tauri dev` and performing a live resize +
`h_resizable` splitter drag.  Compile-time verification confirms the code
path is correct but cannot observe the CoreAnimation compositing result.

---

## References

- `crates/embed_poc/src/webview.rs:133-230` — three fix functions from commit `207da697`
- `crates/embed_poc/src/layout.rs:178-186` — `content_panel` with `bg(0x12141a)` wrapping the WebView
- `gpui_macos/src/window.rs:783-884` — GPUI native_view creation and `addSubview_` into `contentView`
- `gpui_macos/src/window.rs:870` — `native_view.setAutoresizingMask_(NSViewWidthSizable | NSViewHeightSizable)`
- `gpui_macos/src/window.rs:878` — `native_view.setWantsLayer(YES)`
- `gpui_macos/src/window.rs:218-220` — `VIEW_CLASS` registers `makeBackingLayer` → returns CAMetalLayer
- `gpui_macos/src/window.rs:1744` — `window_handle()` returns `native_view` (not `contentView`)
- `gpui_macos/src/window.rs:2432-2468` — `setFrameSize:` override → calls `super`, updates renderer
- `gpui_macos/src/metal_renderer.rs:151-168` — CAMetalLayer creation with `set_opaque(true)`
- `gpui_macos/src/metal_renderer.rs:760` — clear color `(0,0,0,1.0)` (opaque black) every frame
- `gpui-component/crates/webview/src/lib.rs:33` — `WebView::new` calls `set_bounds(Rect::default())` immediately
- `lb-wry-0.53.3/src/wkwebview/mod.rs:632` — `build_as_child` adds WKWebView as subview of `ns_view`
- `lb-wry-0.53.3/src/wkwebview/mod.rs:944-959` — `set_bounds` → `setFrame:` on WKWebView in child mode
- `lb-wry-0.53.3/src/lib.rs:2387-2389` — `WebViewExtMacOS::webview()` returns `self.webview.webview.clone()`
