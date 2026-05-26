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
