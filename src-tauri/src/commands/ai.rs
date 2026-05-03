#[cfg(desktop)]
use crate::ai_agents::{AiAgentStreamRequest, AiAgentsStatus};
use crate::claude_cli::{ChatStreamRequest, ClaudeCliStatus};
use crate::vault::VaultAiGuidanceStatus;

use super::expand_tilde;

#[cfg(desktop)]
type StreamEmitter<Event> = Box<dyn Fn(Event) + Send>;

#[cfg(desktop)]
async fn run_desktop_stream<Event, Request, Runner>(
    app_handle: tauri::AppHandle,
    event_name: &'static str,
    request: Request,
    runner: Runner,
) -> Result<String, String>
where
    Event: serde::Serialize + Send + 'static,
    Request: Send + 'static,
    Runner: FnOnce(Request, StreamEmitter<Event>) -> Result<String, String> + Send + 'static,
{
    use tauri::Emitter;

    tokio::task::spawn_blocking(move || {
        runner(
            request,
            Box::new(move |event| {
                let _ = app_handle.emit(event_name, &event);
            }),
        )
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

#[cfg(desktop)]
macro_rules! define_desktop_stream_command {
    ($name:ident, $request:ty, $event_name:literal, $runner:path) => {
        #[tauri::command]
        pub async fn $name(
            app_handle: tauri::AppHandle,
            request: $request,
        ) -> Result<String, String> {
            run_desktop_stream(app_handle, $event_name, request, $runner).await
        }
    };
}

// ── Claude CLI commands (desktop) ───────────────────────────────────────────

#[cfg(desktop)]
#[tauri::command]
pub fn check_claude_cli() -> ClaudeCliStatus {
    crate::claude_cli::check_cli()
}

#[cfg(desktop)]
#[tauri::command]
pub fn get_ai_agents_status() -> AiAgentsStatus {
    crate::ai_agents::get_ai_agents_status()
}

#[tauri::command]
pub fn get_vault_ai_guidance_status(vault_path: String) -> Result<VaultAiGuidanceStatus, String> {
    let vault_path = expand_tilde(&vault_path);
    crate::vault::get_ai_guidance_status(vault_path.as_ref())
}

#[tauri::command]
pub fn restore_vault_ai_guidance(vault_path: String) -> Result<VaultAiGuidanceStatus, String> {
    let vault_path = expand_tilde(&vault_path);
    crate::vault::restore_ai_guidance_files(vault_path.as_ref())
}

#[cfg(desktop)]
define_desktop_stream_command!(
    stream_claude_chat,
    ChatStreamRequest,
    "claude-stream",
    crate::claude_cli::run_chat_stream
);

#[cfg(desktop)]
fn normalize_agent_request(mut request: AiAgentStreamRequest) -> AiAgentStreamRequest {
    request.vault_path = expand_tilde(&request.vault_path).into_owned();
    request
}

#[cfg(desktop)]
#[tauri::command]
pub async fn stream_ai_agent(
    app_handle: tauri::AppHandle,
    request: AiAgentStreamRequest,
) -> Result<String, String> {
    run_desktop_stream(
        app_handle,
        "ai-agent-stream",
        normalize_agent_request(request),
        crate::ai_agents::run_ai_agent_stream,
    )
    .await
}

// ── Claude CLI (mobile stubs) ───────────────────────────────────────────────

#[cfg(mobile)]
#[tauri::command]
pub fn check_claude_cli() -> ClaudeCliStatus {
    ClaudeCliStatus {
        installed: false,
        version: None,
    }
}

#[cfg(mobile)]
#[tauri::command]
pub fn get_ai_agents_status() -> AiAgentsStatus {
    AiAgentsStatus {
        claude_code: crate::ai_agents::AiAgentAvailability {
            installed: false,
            version: None,
        },
        codex: crate::ai_agents::AiAgentAvailability {
            installed: false,
            version: None,
        },
        opencode: crate::ai_agents::AiAgentAvailability {
            installed: false,
            version: None,
        },
        pi: crate::ai_agents::AiAgentAvailability {
            installed: false,
            version: None,
        },
        gemini: crate::ai_agents::AiAgentAvailability {
            installed: false,
            version: None,
        },
    }
}

#[cfg(mobile)]
#[tauri::command]
pub async fn stream_claude_chat(
    _app_handle: tauri::AppHandle,
    _request: ChatStreamRequest,
) -> Result<String, String> {
    Err("Claude CLI is not available on mobile".into())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn stream_ai_agent(
    _app_handle: tauri::AppHandle,
    _request: AiAgentStreamRequest,
) -> Result<String, String> {
    Err("CLI AI agents are not available on mobile".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::AiGuidanceFileState;

    #[cfg(desktop)]
    #[test]
    fn normalize_agent_request_expands_tilde_in_vault_path() {
        use crate::ai_agents::AiAgentId;

        let home = dirs::home_dir().unwrap();
        let request = AiAgentStreamRequest {
            agent: AiAgentId::ClaudeCode,
            message: "hi".into(),
            system_prompt: None,
            vault_path: "~/Vaults/content".into(),
            permission_mode: None,
        };

        let normalized = normalize_agent_request(request);

        assert_eq!(
            normalized.vault_path,
            format!("{}/Vaults/content", home.display()),
            "vault_path must be tilde-expanded so spawned agents can chdir into it",
        );
    }

    #[cfg(desktop)]
    #[test]
    fn normalize_agent_request_leaves_absolute_vault_path_untouched() {
        use crate::ai_agents::AiAgentId;

        let request = AiAgentStreamRequest {
            agent: AiAgentId::Codex,
            message: "hi".into(),
            system_prompt: None,
            vault_path: "/Users/example/vault".into(),
            permission_mode: None,
        };

        let normalized = normalize_agent_request(request);

        assert_eq!(normalized.vault_path, "/Users/example/vault");
    }

    #[test]
    fn guidance_commands_report_and_restore_vault_guidance_files() {
        let dir = tempfile::TempDir::new().unwrap();
        let vault_path = dir.path().to_string_lossy().to_string();

        let initial = get_vault_ai_guidance_status(vault_path.clone()).unwrap();
        assert_eq!(initial.agents_state, AiGuidanceFileState::Missing);
        assert_eq!(initial.claude_state, AiGuidanceFileState::Missing);
        assert_eq!(initial.gemini_state, AiGuidanceFileState::Missing);
        assert!(initial.can_restore);

        let restored = restore_vault_ai_guidance(vault_path.clone()).unwrap();
        assert_eq!(restored.agents_state, AiGuidanceFileState::Managed);
        assert_eq!(restored.claude_state, AiGuidanceFileState::Managed);
        assert_eq!(restored.gemini_state, AiGuidanceFileState::Managed);
        assert!(!restored.can_restore);

        assert!(dir.path().join("AGENTS.md").exists());
        assert!(dir.path().join("CLAUDE.md").exists());
        assert!(dir.path().join("GEMINI.md").exists());
    }
}
