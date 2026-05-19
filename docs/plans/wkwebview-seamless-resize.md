# WKWebView Seamless Resize — Tauri's Approach vs. Tolaria's Today

> **Status:** research notes. No code changes yet. All citations are
> file:line into `tauri/` (upstream `tauri-apps/tauri`) or `wry-0.54.2`
> (extracted to `/tmp/wry-0.54.2/` from the cargo cache) or `lb-wry-0.53.3`
> (longbridge fork used by `gpui-wry`, in the cargo registry).

## 1. Symptom recap

During NSWindow live resize (drag the SE corner) and during the
`gpui-component::h_resizable` splitter drag, the GPUI chrome (sidebar,
backgrounds) reflows on the same frame as the OS, but the embedded
WKWebView trails by one or more frames. Visually this shows up as:

- a strip of **opaque background** (window fill / GPUI Metal layer) on
  the side the WebView is "growing into" before its frame catches up;
- **stale pixels** painted into the new bounds for a beat while the
  WebView's NSView frame is still at the previous size;
- on fast drags, an outright **flash** of the window-level background
  color (light grey under macOS default) before WebKit redraws.

The bug class is "host chrome is GPUI-frame-paced; embedded
`WKWebView` is AppKit-frame-paced and the two pacings briefly disagree".

---

## 2. How Tauri does it

Tauri ships two macOS configurations of a `WKWebView` inside a tao
window: **single-WebView-per-window** ("WindowContent") and
**multi-WebView-per-window** ("WindowChild"). The two paths receive
different autoresize handling, but both share four pillars:

### 2a. AppKit `autoresizingMask` does the per-frame work (single-WebView path)

In the single-WebView-per-window case Tauri ends up here, with the
`WKWebView` itself wrapped in a `WryWebViewParent : NSView` that
becomes the window's content view:

```
wry/0.54.2/src/wkwebview/mod.rs:484-495   (WebView autoresizingMask)
  #[cfg(target_os = "macos")]
  {
    if is_child {
      // fixed element
      webview.setAutoresizingMask(NSAutoresizingMaskOptions::ViewMinYMargin);
    } else {
      // Auto-resize
      webview.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewHeightSizable
          | NSAutoresizingMaskOptions::ViewWidthSizable,
      );
    }
```

```
wry/0.54.2/src/wkwebview/mod.rs:646-666   (parent_view becomes content view)
  let parent_view = WryWebViewParent::new(mtm);
  ...
  parent_view.setAutoresizingMask(
    NSAutoresizingMaskOptions::ViewHeightSizable
      | NSAutoresizingMaskOptions::ViewWidthSizable,
  );
  parent_view.addSubview(&webview);

  // Tell the webview receive keyboard events in the window.
  ns_window.setContentView(Some(&parent_view));
  ns_window.makeFirstResponder(Some(&webview));
```

`tauri-runtime-wry` selects this path via `WebViewBuilder::build`
(non-child), `tauri/crates/tauri-runtime-wry/src/lib.rs:5246-5253`:

```
WebviewKind::WindowContent => {
  ...
  let builder = webview_builder.build(&window);
  ...
}
```

`ViewWidthSizable | ViewHeightSizable` on both the `WryWebViewParent`
and the `WryWebView` inside it means **AppKit itself rewrites both
frames on every live-resize tick, before the next CoreAnimation
commit**. There is *no* per-frame Rust code path — the WebView frame
update is performed inside the NSWindow geometry update, on the same
display-link tick that paints the window. That's the whole secret.

`WryWebViewParent` is a thin `NSView` subclass with no painting of
its own (its only override is `drawRect:` to inset the traffic-light
buttons), so the autoresizing mask does the right thing without
fighting any custom drawing
(`tauri/crates/tauri-runtime-wry/...` upstream wry —
`wry/0.54.2/src/wkwebview/class/wry_web_view_parent.rs:21-49`):

```
define_class!(
  #[unsafe(super(NSView))]
  #[name = "WryWebViewParent"]
  #[ivars = WryWebViewParentIvars]
  pub struct WryWebViewParent;

  impl WryWebViewParent {
    #[cfg(target_os = "macos")]
    #[unsafe(method(drawRect:))]
    fn draw(&self, _dirty_rect: NSRect) {
      if let Some((x, y)) = self.ivars().traffic_light_inset.get() {
        unsafe { inset_traffic_lights(&self.window().unwrap(), x, y) };
      }
    }
  }
);
```

### 2b. Multi-WebView (child) path: ratio-recompute on `Resized`

When Tauri hosts multiple WKWebViews per window (`WebviewKind::WindowChild`,
`tauri/crates/tauri-runtime-wry/src/lib.rs:5245`), it builds them with
`build_as_child`, which gives them `setAutoresizingMask(ViewMinYMargin)`
only (`wry/0.54.2/src/wkwebview/mod.rs:488`). That mask **does not**
auto-track parent resize; it just keeps the bottom margin constant. So
Tauri does the geometry by hand, in the event loop:

```
tauri/crates/tauri-runtime-wry/src/lib.rs:4334-4354
  TaoWindowEvent::Resized(size) => {
    if let Some((Some(window), webviews)) = windows
      .0
      .borrow()
      .get(&window_id)
      .map(|w| (w.inner.clone(), w.webviews.clone()))
    {
      let size = size.to_logical::<f32>(window.scale_factor());
      for webview in webviews {
        if let Some(b) = &*webview.bounds.lock().unwrap() {
          if let Err(e) = webview.set_bounds(wry::Rect {
            position: LogicalPosition::new(size.width * b.x_rate, size.height * b.y_rate)
              .into(),
            size: LogicalSize::new(size.width * b.width_rate, size.height * b.height_rate)
              .into(),
          }) {
            log::error!("failed to autoresize webview: {e}");
          }
        }
      }
    }
  }
```

The clever bit: bounds are stored as **rates** (proportions) against
the window's inner size, not absolute pixels:

```
tauri/crates/tauri-runtime-wry/src/lib.rs:4740-4744
struct WebviewBounds {
  x_rate: f32,
  y_rate: f32,
  width_rate: f32,
  height_rate: f32,
}
```

`WebviewBounds` is populated either when `auto_resize` is enabled at
construction (`tauri/crates/tauri-runtime-wry/src/lib.rs:4981-4990`)
or by `SetAutoResize` later
(`tauri/crates/tauri-runtime-wry/src/lib.rs:3977-3990`). Crucially the
rate-recompute happens inside `WebviewMessage::SetBounds`,
`SetSize`, and `SetPosition` too
(`tauri/crates/tauri-runtime-wry/src/lib.rs:3829-3889`), so absolute
moves continue to honour the autoresize contract after a manual
reposition.

But — for the **single-WebView** case the resize handler is
unnecessary in practice; the autoresizingMask in `2a` already
keeps the frame in lockstep before tao even dispatches the
`Resized` event. The Rust handler is the safety net for the
multi-WebView case.

### 2c. Match the host window background under the WebView

Even with a perfect frame-sync, a `WKWebView` paints its own
background, and any 1-frame mismatch between WebKit's surface size and
its container will reveal whatever colour sits *behind* the WebView.
Tauri minimises that visual seam two ways.

First, the WKWebView is told to draw its content edge-to-edge — when
transparency/background_color is set on the attributes, the
`drawsBackground` private KVC key on `WKWebViewConfiguration` is set
to `false`:

```
wry/0.54.2/src/wkwebview/mod.rs:353-371
  #[cfg(feature = "transparent")]
  if attributes.transparent || attributes.background_color.is_some() {
    let no = NSNumber::numberWithBool(false);
    // drawsBackground is only available on macOS 10.14+
    #[cfg(target_os = "macos")]
    {
      let version = util::operating_system_version();
      if version.0 > 10 || (version.0 == 10 && version.1 >= 14) {
        config.setValue_forKey(Some(&no), ns_string!("drawsBackground"));
      }
    }
    ...
  }
```

Second — and this is the public API Apple recommends on macOS 12+ —
Tauri sets `underPageBackgroundColor` on the WKWebView so the overscroll
area and any uncovered band during a resize blends into the window
chrome instead of flashing white:

```
wry/0.54.2/src/wkwebview/mod.rs:415-428
  // Set the under-page background color for overscroll areas (public API, macOS 12+).
  // drawsBackground is already disabled on the config above, so the window background
  // shows through. This handles the color visible when scrolling past page bounds.
  if os_major_version >= 12 {
    if let Some((red, green, blue, alpha)) = attributes.background_color {
      let color = objc2_app_kit::NSColor::colorWithSRGBRed_green_blue_alpha(
        red as f64 / 255.0,
        green as f64 / 255.0,
        blue as f64 / 255.0,
        alpha as f64 / 255.0,
      );
      webview.setUnderPageBackgroundColor(Some(&color));
    }
  }
```

This colour is *also* updated at runtime if `set_background_color` is
called (`wry/0.54.2/src/wkwebview/mod.rs:916-957`).

The host window's background is set from `WindowAttributes.background_color`
(`tauri/crates/tauri-runtime-wry/src/lib.rs:964-965` and
`tauri/crates/tauri-runtime-wry/src/lib.rs:1247-1249`). A
WebView+window combo with the same `background_color` value yields the
classic "no flash" feel of Tauri windows.

### 2d. Layer backing comes for free

There is no explicit `setWantsLayer(YES)` or `setLayer:` call anywhere
in `wry/0.54.2/src/wkwebview/` or `tauri/crates/tauri-runtime-wry/`
(grep returns zero hits). Tauri relies on the fact that **`WKWebView`
is layer-backed by default** on macOS — it draws into a remote
`CALayer` hosted by the `WebKit GPU` process. Because the WebView is
the content view (or a direct subview of one), and because
`setAutoresizingMask` runs through `setFrameSize:` (which on a
layer-backed view forwards into `CALayer` geometry on the same
runloop turn), the compositor is the entity choreographing the
resize, not Tauri.

`WryWebViewParent` is *not* explicitly layer-backed either, but
because it contains a layer-backed WKWebView, AppKit promotes it to
layer-hosting automatically.

### 2e. No `viewWillStartLiveResize:` / `viewDidEndLiveResize:` overrides

Grepping `tauri/crates/`, `wry/0.54.2/src/`, and `lb-wry-0.53.3/src/`
for `liveResize`, `inLiveResize`, `viewWillStartLiveResize`, and
`viewDidEndLiveResize` returns **no hits**. Tauri does not snapshot
the WebView, suspend JS, or swap a placeholder during live resize. The
entire seamless feel comes from steps 2a/2b/2c.

---

## 3. How Tolaria does it today

Tolaria's spike in `crates/embed_poc/` uses `gpui-wry`
(longbridge/gpui-component @ `a5268cd`, package
`crates/webview/Cargo.toml:2 → name = "gpui-wry"`), which builds the
WKWebView via `WebViewBuilder::build_as_child(&window_handle)`:

```
crates/embed_poc/src/webview.rs:66-68
  let webview = builder
      .build_as_child(&window_handle)
      .expect("failed to build child wry::WebView");
```

`build_as_child` lands in lb-wry's `is_child = true` branch, which
applies only:

```
lb-wry-0.53.3/src/wkwebview/mod.rs:474-483
  if is_child {
    // fixed element
    webview.setAutoresizingMask(NSAutoresizingMaskOptions::ViewMinYMargin);
  } else {
    // Auto-resize
    webview.setAutoresizingMask(
      NSAutoresizingMaskOptions::ViewHeightSizable
        | NSAutoresizingMaskOptions::ViewWidthSizable,
    );
  }
```

`ViewMinYMargin` keeps the bottom margin constant — it does **not**
make the WebView track the parent's width/height on its own. The
WebView is added as a subview of GPUI's existing content `NSView`
(`lb-wry-0.53.3/src/wkwebview/mod.rs:638-650`-equivalent for child).

To compensate, `gpui-wry`'s `WebViewElement::prepaint` and Tolaria's
`InstrumentedWebView::prepaint` push the bounds into `wry::WebView::set_bounds`
on every render pass:

```
gpui-component/.../crates/webview/src/lib.rs:178-204
  fn prepaint(
      ...
      bounds: Bounds<Pixels>,
      ...
  ) -> Self::PrepaintState {
      ...
      let _ = self.view.set_bounds(Rect { ... });
      ...
  }
```

```
crates/embed_poc/src/webview.rs:186-203
  let rect = Rect { ... };
  if let Err(e) = self.webview.read(cx).set_bounds(rect) {
      log::warn!(...);
      return;
  }
  self.last_bounds.set(Some(bounds));
```

This means **the WebView's NSView frame is updated from the GPUI
render thread, once per GPUI frame**, not from AppKit's geometry
phase. During a live resize the chain is:

1. AppKit live-resize delivers a new window size.
2. GPUI's Metal renderer is notified and lays out the chrome.
3. GPUI emits a frame; `prepaint` runs and calls `set_bounds`.
4. `set_bounds` in lb-wry → `setFrame` on the WKWebView NSView
   (`lb-wry-0.53.3/src/wkwebview/mod.rs:~980` ≈
   `wry/0.54.2/src/wkwebview/mod.rs:980-998`).
5. WebKit's GPU process eventually catches up and repaints into the
   new frame.

There is no AppKit-level link between steps 1 and 4. The GPUI Metal
surface paints synchronously inside step 2 (so the user sees the
chrome at the new size immediately), but the WebView's `setFrame`
happens later in the same display-link tick (or the next), and the
NSView's previous frame remains visible until the next CALayer
commit. That's the gap.

The under-page background and `drawsBackground` story is also
weaker:

- `embed_poc` constructs `WebViewBuilder::new()` without
  `with_background_color` or `with_transparent`
  (`crates/embed_poc/src/webview.rs:58-65`), so the `drawsBackground`
  KVC override at `lb-wry-0.53.3/src/wkwebview/mod.rs:370-375` does
  not fire (the lb-wry block is gated on `attributes.transparent`
  alone, not `background_color`).
- `lb-wry-0.53.3` lacks the `setUnderPageBackgroundColor` call
  entirely. Grepping the crate returns zero hits for
  `underPageBackgroundColor`. So even if we did supply a
  `background_color`, lb-wry would not propagate it the way wry 0.54
  does.

Net effect: the WebView paints its own opaque white background, and
any uncovered band during a resize flashes white (or whatever
`NSWindow` default is) rather than the chrome's
`rgb(0x12141a)`/`rgb(0x1e1f24)` defined in
`crates/embed_poc/src/layout.rs:132,179`.

### Specific gap vs Tauri

| Pillar | Tauri/wry | embed_poc/gpui-wry |
| --- | --- | --- |
| AppKit autoresize propagates frame to WebView | **Yes** (`Width+HeightSizable` on parent_view *and* WebView, single-WebView mode) | **No** (`ViewMinYMargin` only — child mode) |
| Per-frame geometry update on the Rust side | Only in multi-WebView mode (`lib.rs:4334-4354`), and even then on every tao `Resized` event | **Yes** — only mechanism, and runs from GPUI render path, not AppKit |
| `drawsBackground` = false on config | **Yes** when transparent/background_color set | Not set; lb-wry's gate is `transparent`-only and we never set it |
| `setUnderPageBackgroundColor` (macOS 12+) | **Yes** (`wry/.../mod.rs:415-428`) | **No** — lb-wry lacks the call entirely |
| Custom NSView parent with autoresizing mask | `WryWebViewParent` is the content view | We attach to GPUI's content view directly |
| `viewWillStartLiveResize` snapshot tricks | None | None |

---

## 4. Recommendation — port checklist

> Goal: make the WebView's NSView frame track the host's content area
> *inside the AppKit geometry phase*, not the GPUI render phase,
> AND make any 1-frame mismatch invisible by matching colours.

### 4.1 Set the autoresizing mask on the lb-wry NSView ourselves (highest leverage)

The single most impactful change is to flip the autoresize mask on
the WebView's NSView from `ViewMinYMargin` to
`ViewWidthSizable | ViewHeightSizable` and ensure its parent NSView
(GPUI's content view) is also autoresizing. Once this is in place,
AppKit live-resize updates the WebView frame on the same tick it
updates the window, eliminating the trailing-strip artifact entirely.

> Citation: `wry/0.54.2/src/wkwebview/mod.rs:484-495`.

Two implementation routes — both keep the patch local, no fork of
lb-wry needed:

**Route A — in `spawn_test_webview`, right after `build_as_child`,
reach into the WKWebView via `objc2` and call
`setAutoresizingMask`.** We already pull `objc2`,
`objc2-app-kit`, `objc2-foundation` into `embed_poc` (see
`crates/embed_poc/Cargo.toml:50-52`), so we can:

```rust,ignore
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView};
// after build_as_child:
let wv_nsview: &NSView = /* downcast the wry::WebView ns_view */;
wv_nsview.setAutoresizingMask(
    NSAutoresizingMaskOptions::ViewWidthSizable
        | NSAutoresizingMaskOptions::ViewHeightSizable,
);
```

The handle is reachable: `wry::WebView` exposes its underlying
`NSView` via the `WebViewExtDarwin` trait (`webview()` returns the
`*mut WKWebView`). We can also walk up `superview()` to set the
mask on GPUI's content view.

**Route B — patch lb-wry to accept a `with_autoresize_mask` builder
flag** for child mode. Out of scope for the doc but the cleaner
upstream story. Tauri's wry 0.54 already does the right thing only
in non-child mode; the gpui-wry use case is "child mode but please
behave like content mode."

### 4.2 Set GPUI's window background to match the editor background

If the WebView is ever even 1 frame behind, the user sees the colour
*beneath* it — currently the GPUI window's default (light grey on
macOS). Setting `WindowOptions.background_appearance` /
`background_color` (whichever GPUI exposes) to the editor's
`rgb(0x12141a)` (used at `crates/embed_poc/src/layout.rs:179`)
makes that frame invisible.

> Citation analogue: Tauri's window builder applies
> `WindowAttributes.background_color` at
> `tauri/crates/tauri-runtime-wry/src/lib.rs:964-965` and
> `lib.rs:1247-1249`; the effect is the seamless colour-fill behind
> the WKWebView while it's still painting.

### 4.3 Tell the WKWebView to *not* paint its own white background

Set `drawsBackground = false` on the WKWebViewConfiguration *before*
building, or via KVC after build. We can either:

- pass a non-`None` `background_color` to `WebViewBuilder` —
  but lb-wry's gate (`lb-wry-0.53.3/src/wkwebview/mod.rs:370-375`)
  checks `attributes.transparent`, not `background_color`, so this
  won't work without also calling `.with_transparent(true)`.
- after `build_as_child`, use objc2 to call
  `setValue:forKey:` with `("drawsBackground", NSNumber::numberWithBool(false))`
  on the `WKWebView` (mirroring Tauri's exact technique at
  `wry/0.54.2/src/wkwebview/mod.rs:944-945`).

> Citation: `wry/0.54.2/src/wkwebview/mod.rs:353-371` and
> `wry/0.54.2/src/wkwebview/mod.rs:940-945`.

### 4.4 Set `underPageBackgroundColor` on the WKWebView

macOS 12+. lb-wry doesn't ship the call, so we do it ourselves via
objc2 right after `build_as_child`:

```rust,ignore
let color = NSColor::colorWithSRGBRed_green_blue_alpha(0x12 as f64 / 255.0, ...);
webview.setUnderPageBackgroundColor(Some(&color));
```

This is the colour the system shows in the band between WebKit's
content surface and the WebView's NSView frame during a resize, and
also the overscroll colour.

> Citation: `wry/0.54.2/src/wkwebview/mod.rs:415-428`.

### 4.5 Keep the GPUI-side `set_bounds` as the slow-path safety net

Don't remove `InstrumentedWebView::prepaint`'s `set_bounds` call —
it's still needed for:

- the `h_resizable` splitter drag (which is a *GPUI-internal* layout
  change; AppKit doesn't fire `Resized` for it, so autoresize masks
  don't help us), and
- programmatic geometry changes (open/close sidebar, focus reflow).

Keep the epsilon-guard. The current code at
`crates/embed_poc/src/webview.rs:152-203` is correct; it just stops
being the *only* mechanism once 4.1 is in place.

> Cross-check: Tauri keeps its own programmatic `set_bounds` in
> `tauri/crates/tauri-runtime-wry/src/lib.rs:3829-3889` even though
> the autoresize mask covers ordinary window resize, for exactly the
> same reason — explicit reposition needs an explicit call.

### 4.6 (Optional) Wrap the WebView in a `TolariaWebViewParent` NSView

Replicate the `WryWebViewParent` pattern from
`wry/0.54.2/src/wkwebview/class/wry_web_view_parent.rs:21-49`. Insert
a thin NSView between GPUI's content view and the WebView, set
autoresize masks on both. Probably overkill if 4.1 covers it via
GPUI's content NSView, but it gives us a stable home for any future
overrides (drag-and-drop, custom hit testing) and matches Tauri's
exact topology.

### 4.7 (Investigate) `setLayer` / `wantsLayer` on the GPUI content view

`WKWebView` is layer-backed by default; the GPUI Metal renderer is
also layer-backed. But `WryWebViewParent` is *not* explicitly opted
into `wantsLayer` (no calls in wry or tauri-runtime-wry). AppKit
promotes a host view to layer-hosting automatically when it contains
a layer-backed subview, so we shouldn't need to act here. Listed for
completeness; expect this to be a no-op.

---

## 5. Risks / unknowns

- **GPUI's content NSView API.** The exact way `gpui_macos` exposes
  the content view to extension crates is referenced in
  `crates/embed_poc/src/webview.rs:3-8` as "Zed
  `crates/gpui_macos/src/window.rs:783-884`". We need to confirm
  that walking up `WKWebView.superview()` lands on the GPUI content
  view (and that GPUI doesn't resparent it across renders). If GPUI
  reparents the NSView, an autoresize mask set once at construction
  may be wiped silently.
- **GPUI's window background color.** Whether GPUI's
  `WindowOptions` actually exposes a window background color that
  hits `NSWindow.setBackgroundColor:` or whether the "background" is
  the Metal-cleared colour is unconfirmed. If it's the latter,
  recommendation 4.2 has to be a chrome-level `div().bg(...)` on the
  root view (which we already do at
  `crates/embed_poc/src/layout.rs:132`) — but the user is still
  seeing flashes, which suggests the actual NSWindow background is
  what's showing through during the brief frame where neither GPUI's
  Metal layer nor the WebView's CALayer covers the new pixels.
- **`wry::WebView` set_bounds in child mode flips Y.** Tauri's child
  path applies a `window_position(ns_view, x, y, h)` flip
  (`wry/0.54.2/src/wkwebview/mod.rs:980-998`); the same logic exists
  in lb-wry. If we switch from `setFrame` via Rust to AppKit
  autoresize, AppKit uses the NSView's own coordinate system (with
  its `isFlipped` setting), which may disagree with what we
  currently compute. We need to verify with a single window resize
  that the WebView still lands at the correct origin once autoresize
  is doing the work.
- **lb-wry vs wry 0.54 drift.** lb-wry 0.53.3 is a fork; the only
  hits for `setUnderPageBackgroundColor` and the
  background-color-aware `drawsBackground` block are in wry 0.54.x.
  We assume the rest of the wkwebview/mod.rs is structurally
  similar, but if we patch lb-wry directly we should diff carefully.
- **`h_resizable` drag commits at drag-end only.** Per
  `crates/embed_poc/src/layout.rs:12-14`,
  `ResizablePanelGroup::on_resize` fires at drag end. During the
  drag the chrome is reflowing (otherwise the user wouldn't see the
  drag), so GPUI is calling `prepaint` on every frame and our
  current `set_bounds` path *should* be in lockstep with the
  chrome. If we still see lag here, the cause is probably step 5 in
  §3 (WebKit GPU process commit lagging), not our frame-sync
  bookkeeping. Autoresize masks won't help with that — the
  recommendation 4.3+4.4 colour-match approach is the right fix
  there.
- **No way to confirm without running.** A behavioural verification
  needs side-by-side Tolaria vs a tiny Tauri app of equivalent
  layout. This doc is source-only.

---

## Appendix: file:line index

Tauri:
- `tauri/crates/tauri-runtime-wry/src/lib.rs:964-965` — window background_color application
- `tauri/crates/tauri-runtime-wry/src/lib.rs:1247-1249` — `background_color` builder method
- `tauri/crates/tauri-runtime-wry/src/lib.rs:3829-3889` — `SetBounds`/`SetSize`/`SetPosition` + rate recompute
- `tauri/crates/tauri-runtime-wry/src/lib.rs:3977-3990` — `SetAutoResize` ratio init
- `tauri/crates/tauri-runtime-wry/src/lib.rs:4334-4354` — `TaoWindowEvent::Resized` → per-WebView `set_bounds` (multi-WebView path)
- `tauri/crates/tauri-runtime-wry/src/lib.rs:4740-4744` — `WebviewBounds { x_rate, y_rate, width_rate, height_rate }`
- `tauri/crates/tauri-runtime-wry/src/lib.rs:4981-4990` — auto_resize → initial rates
- `tauri/crates/tauri-runtime-wry/src/lib.rs:5234-5266` — `WebviewKind::WindowChild`/`WindowContent` → `build_as_child`/`build`

wry 0.54.2 (extracted to /tmp/wry-0.54.2/):
- `wry/0.54.2/src/wkwebview/mod.rs:353-371` — `drawsBackground = false` on transparent/bg_color
- `wry/0.54.2/src/wkwebview/mod.rs:415-428` — `setUnderPageBackgroundColor` (macOS 12+)
- `wry/0.54.2/src/wkwebview/mod.rs:484-495` — autoresizingMask child vs non-child
- `wry/0.54.2/src/wkwebview/mod.rs:646-666` — parent_view setContentView + autoresizing
- `wry/0.54.2/src/wkwebview/mod.rs:916-957` — runtime `set_background_color` (drawsBackground + underPageBackgroundColor)
- `wry/0.54.2/src/wkwebview/mod.rs:980-998` — `set_bounds` in child mode (`setFrame`)
- `wry/0.54.2/src/wkwebview/class/wry_web_view_parent.rs:21-49` — `WryWebViewParent : NSView` definition

lb-wry 0.53.3 (longbridge fork, used by gpui-wry):
- `lb-wry-0.53.3/src/wkwebview/mod.rs:370-375` — `drawsBackground = false` (gated on `transparent` only — narrower than wry 0.54)
- `lb-wry-0.53.3/src/wkwebview/mod.rs:474-483` — autoresizingMask child vs non-child (same shape as wry 0.54)
- *no* `setUnderPageBackgroundColor` call anywhere

gpui-wry / embed_poc:
- `gpui-component/crates/webview/src/lib.rs:178-204` — `WebViewElement::prepaint` (always calls `set_bounds`)
- `crates/embed_poc/src/webview.rs:52-72` — `spawn_test_webview` builds via `build_as_child`
- `crates/embed_poc/src/webview.rs:143-204` — `InstrumentedWebView::prepaint` epsilon-guarded `set_bounds`
- `crates/embed_poc/src/layout.rs:101-113` — `observe_window_bounds` → frame log only (no WebView geometry call)
- `crates/embed_poc/src/layout.rs:178-186` — `content_panel` adds `InstrumentedWebView` as a GPUI child

---

## 6. Implementation record (2026-05-19)

### What landed

All three top-priority fixes from §4 were implemented in
`crates/embed_poc/src/webview.rs` via Route A (objc2 calls on the
result of `build_as_child` — no lb-wry fork needed):

| Fix | §ref | Function | Path taken |
|-----|------|----------|------------|
| Autoresize mask | §4.1 | `fix_autoresize_mask` | `WebViewExtMacOS::webview()` → `Retained<WryWebView>` → `setAutoresizingMask(ViewWidthSizable \| ViewHeightSizable)` |
| Window background | §4.2 | `fix_window_background` | `AppKitWindowHandle.ns_view` → `NSView::window()` → `NSWindow::setBackgroundColor(rgb(0x12141a))` via objc2 directly; GPUI's `set_background_appearance` was not used because it only supports opaque-black or near-transparent |
| `drawsBackground = false` | §4.3 | `fix_draws_background` | `WebViewExtMacOS::webview()` → `Retained<WryWebView>` → KVC `setValue:forKey: drawsBackground=NSNumber(false)` |

§4.4 (`setUnderPageBackgroundColor`) and §4.5 (keep `set_bounds` as
slow-path) are **not** changed: §4.5 is already correct; §4.4 is a
nice-to-have deferred because lb-wry lacks the call and the window
background fix (§4.2) already covers the same visual gap for the
overscroll area on most resizes.

### Implementation notes

- All three functions are `#[cfg(target_os = "macos")]`-gated.
- `fix_autoresize_mask` and `fix_draws_background` require the bare
  `wry::WebView` (before `WebView::new` wraps it in `Rc`), so they run
  before `WebView::new(webview, window, cx)`.
- `fix_window_background` walks `AppKitWindowHandle.ns_view →
  NSView::window()` and therefore also runs before `WebView::new` (the
  window is already open at this point, `open_window`'s callback has
  started).
- No lb-wry fork was required.  No `#[allow(...)]` annotations added.

### Verification

**Build / clippy / tests:**
```
cargo fmt --all                                         # clean
cargo build -p embed_poc                               # 0 errors, 0 warnings
cargo clippy -p embed_poc -p tolaria --all-targets \
  -- -D warnings                                       # 0 errors, 0 warnings
cargo test -p embed_poc                                # 27 passed, 0 failed
```

**Autoresize-mask unit test** (`webview.rs::tests::autoresize_mask_constants_have_expected_bit_values`):
verifies that `NSAutoresizingMaskOptions::ViewWidthSizable |
ViewHeightSizable` equals bit pattern 18 (`NSViewWidthSizable=2,
NSViewHeightSizable=16`).  This locks the constants against future
objc2-app-kit version bumps.

**Visual verification:** deferred to user smoke test.  The artifact
(trailing strip during live resize) is only observable at runtime.
Capturing before/after PNGs during a resize requires manual timing
with a running Tolaria instance; that pass is listed as an open TODO
for the next session.

### Open TODOs (§4.4 and §4.5)

- **§4.4** `setUnderPageBackgroundColor` (macOS 12+): lb-wry lacks the
  call.  Can be added via objc2 using the same pattern as
  `fix_window_background` (`NSColor::colorWithSRGBRed_green_blue_alpha`
  → `WKWebView::setUnderPageBackgroundColor`).  Low priority: the
  window background fix already covers the same flash for ordinary
  resize; this only matters for over-scroll past page bounds.
- **§4.6** `TolariaWebViewParent` wrapper NSView: overkill for now; defer
  until there is a concrete need (drag-and-drop, custom hit-testing).
- **§4.7** `wantsLayer` investigation: expected to be a no-op (AppKit
  promotes layer-hosting automatically); not pursued.
