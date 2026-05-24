use tauri::Manager;

const LIGHT_ICON_BYTES: &[u8] = include_bytes!("../icons/512x512.png");
const DARK_ICON_BYTES: &[u8] = include_bytes!("../icons/512x512-dark.png");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AppIconMode {
    Light,
    Dark,
}

impl AppIconMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            _ => Err(format!("Unsupported app icon theme mode: {value}")),
        }
    }

    fn png_bytes(self) -> &'static [u8] {
        match self {
            Self::Light => LIGHT_ICON_BYTES,
            Self::Dark => DARK_ICON_BYTES,
        }
    }
}

pub fn update_app_icon_for_theme(
    app_handle: &tauri::AppHandle,
    theme_mode: &str,
) -> Result<(), String> {
    let icon_bytes = AppIconMode::parse(theme_mode)?.png_bytes();
    let image = tauri::image::Image::from_bytes(icon_bytes)
        .map_err(|err| format!("Failed to decode app icon: {err}"))?;

    for window in app_handle.webview_windows().into_values() {
        window
            .set_icon(image.clone())
            .map_err(|err| format!("Failed to update window icon: {err}"))?;
    }

    apply_platform_app_icon(app_handle, icon_bytes)
}

#[cfg(target_os = "macos")]
fn apply_platform_app_icon(
    app_handle: &tauri::AppHandle,
    icon_bytes: &'static [u8],
) -> Result<(), String> {
    app_handle
        .run_on_main_thread(move || {
            if let Err(err) = set_macos_application_icon(icon_bytes) {
                log::warn!("Failed to update macOS application icon: {err}");
            }
        })
        .map_err(|err| format!("Failed to schedule macOS app icon update: {err}"))
}

#[cfg(target_os = "macos")]
fn set_macos_application_icon(icon_bytes: &[u8]) -> Result<(), String> {
    use objc2::AllocAnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{MainThreadMarker, NSData};

    let marker = unsafe { MainThreadMarker::new_unchecked() };
    let app = NSApplication::sharedApplication(marker);
    let data = NSData::with_bytes(icon_bytes);
    let app_icon = NSImage::initWithData(NSImage::alloc(), &data)
        .ok_or_else(|| "Failed to create macOS app icon image".to_string())?;
    unsafe { app.setApplicationIconImage(Some(&app_icon)) };
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn apply_platform_app_icon(
    _app_handle: &tauri::AppHandle,
    _icon_bytes: &'static [u8],
) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::AppIconMode;

    #[test]
    fn parses_supported_icon_modes() {
        assert_eq!(AppIconMode::parse("light"), Ok(AppIconMode::Light));
        assert_eq!(AppIconMode::parse("dark"), Ok(AppIconMode::Dark));
    }

    #[test]
    fn rejects_unknown_icon_modes() {
        assert!(AppIconMode::parse("system").is_err());
    }
}
