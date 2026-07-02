use super::expand_tilde;

#[cfg(desktop)]
#[tauri::command]
pub async fn clone_git_repo(url: String, local_path: String) -> Result<String, String> {
    let url = crate::git::validate_user_remote_url(&url)?.to_string();
    let local_path = expand_tilde(&local_path).into_owned();

    tokio::task::spawn_blocking(move || crate::git::clone_repo(&url, &local_path))
        .await
        .map_err(|e| format!("Task panicked: {e}"))?
}

#[cfg(mobile)]
#[tauri::command]
pub async fn clone_git_repo(_url: String, _local_path: String) -> Result<String, String> {
    Err("Git clone is not available on mobile".into())
}
