#[cfg(desktop)]
use crate::ai_agents::{AiAgentStreamRequest, AiAgentsStatus};
#[cfg(desktop)]
use crate::ai_models::{AiModelProviderTestRequest, AiModelStreamRequest};
use crate::claude_cli::{ChatStreamRequest, ClaudeCliStatus};
use crate::vault::VaultAiGuidanceStatus;

use super::expand_tilde;

#[cfg(desktop)]
type StreamEmitter<Event> = Box<dyn Fn(Event) + Send>;

#[cfg(desktop)]
const AGENT_DOCS_RESOURCE_DIR: &str = "agent-docs";

#[cfg(desktop)]
async fn run_desktop_stream<Event, Request, Runner>(
    app_handle: tauri::AppHandle,
    event_name: String,
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
                let _ = app_handle.emit(event_name.as_str(), &event);
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
            run_desktop_stream(app_handle, $event_name.to_string(), request, $runner).await
        }
    };
}

#[cfg(desktop)]
fn is_scoped_stream_event_name(default_event_name: &str, event_name: &str) -> bool {
    event_name
        .strip_prefix(default_event_name)
        .and_then(|suffix| suffix.strip_prefix('-'))
        .is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-')
        })
}

#[cfg(desktop)]
fn stream_event_name(default_event_name: &'static str, requested: Option<&str>) -> String {
    requested
        .filter(|event_name| is_scoped_stream_event_name(default_event_name, event_name))
        .unwrap_or(default_event_name)
        .to_string()
}

// ── Claude CLI commands (desktop) ───────────────────────────────────────────

#[cfg(desktop)]
#[tauri::command]
pub fn check_claude_cli() -> ClaudeCliStatus {
    crate::claude_cli::check_cli()
}

#[cfg(desktop)]
#[tauri::command]
pub async fn get_ai_agents_status() -> AiAgentsStatus {
    crate::ai_agents::get_ai_agents_status().await
}

#[cfg(desktop)]
#[tauri::command]
pub fn get_agent_docs_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    use std::path::PathBuf;
    use tauri::path::BaseDirectory;
    use tauri::Manager;

    let mut candidates = Vec::new();

    if let Ok(resource_path) = app_handle
        .path()
        .resolve(AGENT_DOCS_RESOURCE_DIR, BaseDirectory::Resource)
    {
        candidates.push(resource_path);
    }

    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(AGENT_DOCS_RESOURCE_DIR),
    );

    candidates
        .into_iter()
        .find(|path| path.join("index.md").is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| "Tolaria agent docs are not bundled in this build.".to_string())
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
    request.vault_paths = request
        .vault_paths
        .into_iter()
        .map(|path| expand_tilde(&path).into_owned())
        .collect();
    request
}

#[cfg(desktop)]
fn run_normalized_ai_agent_stream(
    request: AiAgentStreamRequest,
    emitter: StreamEmitter<crate::ai_agents::AiAgentStreamEvent>,
) -> Result<String, String> {
    crate::ai_agents::run_ai_agent_stream(normalize_agent_request(request), emitter)
}

#[cfg(desktop)]
#[tauri::command]
pub async fn stream_ai_agent(
    app_handle: tauri::AppHandle,
    request: AiAgentStreamRequest,
) -> Result<String, String> {
    let event_name = stream_event_name("ai-agent-stream", request.event_name.as_deref());
    run_desktop_stream(
        app_handle,
        event_name,
        request,
        run_normalized_ai_agent_stream,
    )
    .await
}

#[cfg(desktop)]
#[tauri::command]
pub async fn stream_ai_model(
    app_handle: tauri::AppHandle,
    request: AiModelStreamRequest,
) -> Result<String, String> {
    let event_name = stream_event_name("ai-model-stream", request.event_name.as_deref());
    run_desktop_stream(
        app_handle,
        event_name,
        request,
        crate::ai_models::run_ai_model_stream,
    )
    .await
}

#[cfg(desktop)]
#[tauri::command]
pub fn save_ai_model_provider_api_key(provider_id: String, api_key: String) -> Result<(), String> {
    crate::ai_models::save_provider_api_key(provider_id, api_key)
}

#[cfg(desktop)]
#[tauri::command]
pub fn delete_ai_model_provider_api_key(provider_id: String) -> Result<(), String> {
    crate::ai_models::delete_provider_api_key(provider_id)
}

#[cfg(desktop)]
#[tauri::command]
pub fn test_ai_model_provider(request: AiModelProviderTestRequest) -> Result<String, String> {
    crate::ai_models::test_ai_model_provider(request)
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
        kiro: crate::ai_agents::AiAgentAvailability {
            installed: false,
            version: None,
        },
        hermes: crate::ai_agents::AiAgentAvailability {
            installed: false,
            version: None,
        },
    }
}

#[cfg(mobile)]
#[tauri::command]
pub fn get_agent_docs_path() -> Result<String, String> {
    Err("Bundled agent docs are only available in the desktop app.".into())
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

#[cfg(mobile)]
#[tauri::command]
pub async fn stream_ai_model(
    _app_handle: tauri::AppHandle,
    _request: crate::ai_models::AiModelStreamRequest,
) -> Result<String, String> {
    Err("Direct AI model chat is not available in this mobile build yet.".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn save_ai_model_provider_api_key(
    _provider_id: String,
    _api_key: String,
) -> Result<(), String> {
    Err("Local AI provider secret storage is only available in the desktop app.".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn delete_ai_model_provider_api_key(_provider_id: String) -> Result<(), String> {
    Err("Local AI provider secret storage is only available in the desktop app.".into())
}

#[cfg(mobile)]
#[tauri::command]
pub fn test_ai_model_provider(
    _request: crate::ai_models::AiModelProviderTestRequest,
) -> Result<String, String> {
    Err("Direct AI model tests are not available in this mobile build yet.".into())
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
            vault_paths: vec!["~/Vaults/secondary".into()],
            permission_mode: None,
            event_name: None,
        };

        let normalized = normalize_agent_request(request);

        assert_eq!(
            normalized.vault_path,
            format!("{}/Vaults/content", home.display()),
            "vault_path must be tilde-expanded so spawned agents can chdir into it",
        );
        assert_eq!(
            normalized.vault_paths,
            vec![format!("{}/Vaults/secondary", home.display())],
            "vault_paths must be tilde-expanded so spawned agents can access every active vault",
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
            vault_paths: Vec::new(),
            permission_mode: None,
            event_name: None,
        };

        let normalized = normalize_agent_request(request);

        assert_eq!(normalized.vault_path, "/Users/example/vault");
    }

    #[cfg(desktop)]
    #[test]
    fn stream_event_name_accepts_only_scoped_names() {
        assert_eq!(
            stream_event_name("ai-agent-stream", Some("ai-agent-stream-chat-123")),
            "ai-agent-stream-chat-123",
        );
        assert_eq!(
            stream_event_name("ai-agent-stream", Some("ai-model-stream-chat-123")),
            "ai-agent-stream",
        );
        assert_eq!(
            stream_event_name("ai-agent-stream", Some("ai-agent-stream/../bad")),
            "ai-agent-stream",
        );
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
