#[cfg(desktop)]
#[tauri::command]
pub fn update_app_icon(app_handle: tauri::AppHandle, theme_mode: String) -> Result<(), String> {
    crate::app_icon::update_app_icon_for_theme(&app_handle, &theme_mode)
}

#[cfg(mobile)]
#[tauri::command]
pub fn update_app_icon(_theme_mode: String) -> Result<(), String> {
    Ok(())
}
