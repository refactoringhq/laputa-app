use crate::git::GitAddRemoteResult;
use serde::Deserialize;

use super::expand_tilde;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAddRemoteRequest {
    vault_path: String,
    remote_url: String,
}

#[cfg(desktop)]
#[tauri::command]
pub async fn git_add_remote(request: GitAddRemoteRequest) -> Result<GitAddRemoteResult, String> {
    let vault_path = expand_tilde(&request.vault_path).into_owned();
    let remote_url = match crate::git::validate_user_remote_url(&request.remote_url) {
        Ok(url) => url.to_string(),
        Err(message) => {
            return Ok(GitAddRemoteResult {
                status: "error".to_string(),
                message,
            });
        }
    };

    tokio::task::spawn_blocking(move || crate::git::git_add_remote(&vault_path, &remote_url))
        .await
        .map_err(|e| format!("Task panicked: {e}"))?
}

#[cfg(mobile)]
#[tauri::command]
pub async fn git_add_remote(_request: GitAddRemoteRequest) -> Result<GitAddRemoteResult, String> {
    Err("Adding git remotes is not available on mobile".into())
}
