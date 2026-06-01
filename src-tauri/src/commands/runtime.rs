fn should_use_external_media_preview_for_appimage(is_linux_appimage: bool) -> bool {
    is_linux_appimage
}

fn map_print_result<E: std::fmt::Display>(result: Result<(), E>) -> Result<(), String> {
    result.map_err(|error| format!("Failed to open the system print dialog: {error}"))
}

#[cfg(all(desktop, target_os = "linux"))]
fn linux_appimage_running() -> bool {
    crate::linux_appimage::is_running()
}

#[cfg(not(all(desktop, target_os = "linux")))]
fn linux_appimage_running() -> bool {
    false
}

#[tauri::command]
pub fn should_use_external_media_preview() -> bool {
    should_use_external_media_preview_for_appimage(linux_appimage_running())
}

#[tauri::command]
pub fn print_current_webview(window: tauri::WebviewWindow) -> Result<(), String> {
    map_print_result(window.print())
}

#[cfg(test)]
mod tests {
    use super::{map_print_result, should_use_external_media_preview_for_appimage};

    #[test]
    fn external_media_preview_is_limited_to_linux_appimage() {
        assert!(should_use_external_media_preview_for_appimage(true));
        assert!(!should_use_external_media_preview_for_appimage(false));
    }

    #[test]
    fn print_errors_are_formatted_for_the_renderer() {
        let result = map_print_result::<&str>(Err("printer unavailable"));

        assert_eq!(
            result,
            Err("Failed to open the system print dialog: printer unavailable".to_string())
        );
    }
}
