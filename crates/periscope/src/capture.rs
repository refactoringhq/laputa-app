//! macOS screen capture adapter, wrapping `xcap`.
//!
//! Public surface lives in `super` ([`super::screenshot`] /
//! [`super::list_windows`]); this module implements only the
//! macOS-side bindings.

use anyhow::{anyhow, Context as _, Result};
use std::path::{Path, PathBuf};

use crate::{WindowSummary, WindowTarget};

/// Mean per-channel luminance below this threshold (0..=255) is treated
/// as "capture returned a black frame" — the signature failure mode
/// when Screen Recording permission is missing.
const BLACK_FRAME_MEAN_THRESHOLD: u32 = 4;

/// Sentinel for very tiny PNG payloads — a backup signal alongside the
/// pixel check.  Real Tolaria captures land well above 50 kB even at
/// minimum window size.
const MIN_USEFUL_PNG_BYTES: u64 = 10_000;

pub(crate) fn screenshot_macos(target: &WindowTarget, out: &Path) -> Result<PathBuf> {
    let window = find_window(target)?;
    let image = window
        .capture_image()
        .context("xcap::Window::capture_image failed")?;

    if is_black_frame(&image) {
        let terminal = std::env::var("TERM_PROGRAM").unwrap_or_else(|_| "<unknown>".into());
        return Err(anyhow!(
            "captured frame is all black — likely Screen Recording permission \
             missing for {terminal} (System Settings → Privacy & Security → \
             Screen Recording).  Other causes: the window is off-screen, \
             minimized, or covered by an opaque overlay."
        ));
    }

    write_png(&image, out)
}

/// Capture the window and write a PNG cropped to the bounds of the element
/// identified by `id` in the most recent `tree_dump` JSON for `pid`.
///
/// `bounds` are in **window-frame logical points** as reported by the
/// `tree_dump` JSON.  The captured image is in device pixels (2× on Retina),
/// so `bounds` are scaled by `image_pixel_width / window_logical_width`
/// before the crop.
pub(crate) fn screenshot_cropped_macos(
    target: &WindowTarget,
    bounds: crate::tree_dump::NamedBounds,
    out: &Path,
) -> Result<PathBuf> {
    let window = find_window(target)?;
    let image = window
        .capture_image()
        .context("xcap::Window::capture_image failed")?;

    if is_black_frame(&image) {
        let terminal = std::env::var("TERM_PROGRAM").unwrap_or_else(|_| "<unknown>".into());
        return Err(anyhow!(
            "captured frame is all black — likely Screen Recording permission \
             missing for {terminal} (System Settings → Privacy & Security → \
             Screen Recording).  Other causes: the window is off-screen, \
             minimized, or covered by an opaque overlay."
        ));
    }

    // Derive the device pixel ratio from the logical window size reported
    // by the OS vs the pixel dimensions of the captured image.
    let (img_w, img_h) = image.dimensions();
    let scale = {
        let logical_w = window.width().unwrap_or(0);
        if logical_w == 0 || img_w == 0 {
            1.0_f64
        } else {
            f64::from(img_w) / f64::from(logical_w)
        }
    };

    // Convert logical-point bounds → pixel rect, then clamp to image dims.
    let px = (f64::from(bounds.x) * scale).round() as u32;
    let py = (f64::from(bounds.y) * scale).round() as u32;
    let pw = (f64::from(bounds.width) * scale).round() as u32;
    let ph = (f64::from(bounds.height) * scale).round() as u32;

    let clamped_x = px.min(img_w);
    let clamped_y = py.min(img_h);
    let clamped_w = pw.min(img_w.saturating_sub(clamped_x));
    let clamped_h = ph.min(img_h.saturating_sub(clamped_y));

    if clamped_w == 0 || clamped_h == 0 {
        return Err(anyhow!(
            "element bounds ({px},{py} {pw}×{ph} px at scale {scale:.2}×) \
             fall entirely outside the captured image ({img_w}×{img_h} px) — \
             element may be off-screen or occluded"
        ));
    }

    let cropped =
        xcap::image::imageops::crop_imm(&image, clamped_x, clamped_y, clamped_w, clamped_h)
            .to_image();

    write_png(&cropped, out)
}

fn write_png(image: &xcap::image::RgbaImage, out: &Path) -> Result<PathBuf> {
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating parent dir {parent:?} for screenshot output"))?;
    }
    image
        .save(out)
        .with_context(|| format!("writing PNG to {out:?}"))?;

    let bytes = std::fs::metadata(out)
        .with_context(|| format!("stat {out:?}"))?
        .len();
    if bytes < MIN_USEFUL_PNG_BYTES {
        let terminal = std::env::var("TERM_PROGRAM").unwrap_or_else(|_| "<unknown>".into());
        return Err(anyhow!(
            "captured PNG is only {bytes} bytes — likely Screen Recording \
             permission missing for {terminal} (System Settings → Privacy & \
             Security → Screen Recording).  Re-run after granting."
        ));
    }
    Ok(out.to_path_buf())
}

/// True when the image's mean RGB luminance falls below
/// [`BLACK_FRAME_MEAN_THRESHOLD`].  Sampled rather than full-scanned to
/// keep the per-capture cost flat for high-resolution screens.
fn is_black_frame(image: &xcap::image::RgbaImage) -> bool {
    let (w, h) = image.dimensions();
    if w == 0 || h == 0 {
        return true;
    }
    // Sample on a coarse grid — 32×32 = 1024 pixels regardless of
    // window resolution.  Plenty to detect "entire frame is black".
    const GRID: u32 = 32;
    let step_x = (w / GRID).max(1);
    let step_y = (h / GRID).max(1);
    let mut sum: u64 = 0;
    let mut count: u64 = 0;
    let mut y = 0;
    while y < h {
        let mut x = 0;
        while x < w {
            let p = image.get_pixel(x, y).0;
            sum += u64::from(p[0]) + u64::from(p[1]) + u64::from(p[2]);
            count += 3;
            x += step_x;
        }
        y += step_y;
    }
    let mean = u32::try_from(sum / count.max(1)).unwrap_or(u32::MAX);
    mean < BLACK_FRAME_MEAN_THRESHOLD
}

pub(crate) fn list_macos() -> Result<Vec<WindowSummary>> {
    let mut out = Vec::new();
    for window in xcap::Window::all().context("xcap::Window::all failed")? {
        let Ok(title) = window.title() else { continue };
        let Ok(app_name) = window.app_name() else {
            continue;
        };
        let Ok(pid) = window.pid() else { continue };
        out.push(WindowSummary {
            pid,
            title,
            app_name,
        });
    }
    Ok(out)
}

/// Locate a single `xcap::Window` matching `target`.  Errors when
/// nothing matches; returns the first hit on ties (Tolaria opens one
/// window per process so ties shouldn't happen in practice).
pub(crate) fn find_window(target: &WindowTarget) -> Result<xcap::Window> {
    let windows = xcap::Window::all().context("xcap::Window::all failed")?;
    match target {
        WindowTarget::ByTitle(want) => windows
            .into_iter()
            .find(|w| matches!(w.title(), Ok(t) if t == *want))
            .ok_or_else(|| anyhow!("no window with title {want:?}")),
        WindowTarget::ByPid(want) => windows
            .into_iter()
            .find(|w| matches!(w.pid(), Ok(p) if p == *want))
            .ok_or_else(|| anyhow!("no window owned by pid {want}")),
    }
}
