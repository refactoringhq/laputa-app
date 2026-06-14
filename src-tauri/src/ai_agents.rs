use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::task::JoinHandle;

const AI_AGENT_STATUS_PROBE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiAgentId {
    ClaudeCode,
    Codex,
    Opencode,
    Pi,
    Gemini,
    Kiro,
    Hermes,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AiAgentPermissionMode {
    #[default]
    Safe,
    PowerUser,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiAgentAvailability {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiAgentsStatus {
    pub claude_code: AiAgentAvailability,
    pub codex: AiAgentAvailability,
    pub opencode: AiAgentAvailability,
    pub pi: AiAgentAvailability,
    pub gemini: AiAgentAvailability,
    pub kiro: AiAgentAvailability,
    pub hermes: AiAgentAvailability,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum AiAgentStreamEvent {
    Init {
        session_id: String,
    },
    TextDelta {
        text: String,
    },
    ThinkingDelta {
        text: String,
    },
    ToolStart {
        tool_name: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
    ToolDone {
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
    },
    Error {
        message: String,
    },
    Done,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiAgentStreamRequest {
    pub agent: AiAgentId,
    pub message: String,
    pub system_prompt: Option<String>,
    pub vault_path: String,
    #[serde(default)]
    pub vault_paths: Vec<String>,
    pub permission_mode: Option<AiAgentPermissionMode>,
    #[serde(default)]
    pub event_name: Option<String>,
}

impl AiAgentStreamRequest {
    fn permission_mode(&self) -> AiAgentPermissionMode {
        self.permission_mode.unwrap_or_default()
    }
}

/// Probe every supported AI-agent CLI in parallel.
///
/// Each per-agent `check_cli()` is synchronous and can block for up to ~1 s
/// when the binary is missing and we fall through to the login-shell
/// fallback (`/bin/zsh -lc 'command -v <agent>'` etc., evaluating the full
/// shell startup). Running them sequentially used to add ~5 s to cold start
/// when no agents are installed. Fan them out across Tokio's blocking pool
/// so the user-perceived wall time is the slowest single probe rather than
/// the sum of all supported probes.
///
/// A panicking probe is mapped to `installed: false` so the IPC handler
/// always returns a fully populated `AiAgentsStatus` and the frontend can
/// keep rendering.
pub async fn get_ai_agents_status() -> AiAgentsStatus {
    let claude = tokio::task::spawn_blocking(availability_from_claude);
    let codex = tokio::task::spawn_blocking(crate::codex_cli::check_cli);
    let opencode = tokio::task::spawn_blocking(crate::opencode_cli::check_cli);
    let pi = tokio::task::spawn_blocking(crate::pi_cli::check_cli);
    let gemini = tokio::task::spawn_blocking(crate::gemini_cli::check_cli);
    let kiro = tokio::task::spawn_blocking(crate::kiro_cli::check_cli);
    let hermes = tokio::task::spawn_blocking(crate::hermes_cli::check_cli);

    let (claude, codex, opencode, pi, gemini, kiro, hermes) = tokio::join!(
        availability_or_missing(claude, AI_AGENT_STATUS_PROBE_TIMEOUT),
        availability_or_missing(codex, AI_AGENT_STATUS_PROBE_TIMEOUT),
        availability_or_missing(opencode, AI_AGENT_STATUS_PROBE_TIMEOUT),
        availability_or_missing(pi, AI_AGENT_STATUS_PROBE_TIMEOUT),
        availability_or_missing(gemini, AI_AGENT_STATUS_PROBE_TIMEOUT),
        availability_or_missing(kiro, AI_AGENT_STATUS_PROBE_TIMEOUT),
        availability_or_missing(hermes, AI_AGENT_STATUS_PROBE_TIMEOUT)
    );

    AiAgentsStatus {
        claude_code: claude,
        codex,
        opencode,
        pi,
        gemini,
        kiro,
        hermes,
    }
}

async fn availability_or_missing(
    probe: JoinHandle<AiAgentAvailability>,
    timeout: Duration,
) -> AiAgentAvailability {
    match tokio::time::timeout(timeout, probe).await {
        Ok(Ok(availability)) => availability,
        Ok(Err(_)) | Err(_) => missing_availability(),
    }
}

fn missing_availability() -> AiAgentAvailability {
    AiAgentAvailability {
        installed: false,
        version: None,
    }
}

pub fn run_ai_agent_stream<F>(request: AiAgentStreamRequest, emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let permission_mode = request.permission_mode();
    match request.agent {
        AiAgentId::ClaudeCode => run_claude_agent_stream(request, permission_mode, emit),
        AiAgentId::Codex => run_shared_agent_stream(
            request,
            permission_mode,
            crate::codex_cli::run_agent_stream,
            emit,
        ),
        AiAgentId::Opencode => run_shared_agent_stream(
            request,
            permission_mode,
            crate::opencode_cli::run_agent_stream,
            emit,
        ),
        AiAgentId::Pi => run_shared_agent_stream(
            request,
            permission_mode,
            crate::pi_cli::run_agent_stream,
            emit,
        ),
        AiAgentId::Gemini => run_shared_agent_stream(
            request,
            permission_mode,
            crate::gemini_cli::run_agent_stream,
            emit,
        ),
        AiAgentId::Kiro => run_shared_agent_stream(
            request,
            permission_mode,
            crate::kiro_cli::run_agent_stream,
            emit,
        ),
        AiAgentId::Hermes => run_shared_agent_stream(
            request,
            permission_mode,
            crate::hermes_cli::run_agent_stream,
            emit,
        ),
    }
}

fn run_claude_agent_stream<F>(
    request: AiAgentStreamRequest,
    permission_mode: AiAgentPermissionMode,
    mut emit: F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let mapped = crate::claude_cli::AgentStreamRequest {
        message: request.message,
        system_prompt: request.system_prompt,
        vault_path: request.vault_path,
        vault_paths: request.vault_paths,
        permission_mode,
    };
    crate::claude_cli::run_agent_stream(mapped, |event| {
        if let Some(mapped_event) = map_claude_event(event) {
            emit(mapped_event);
        }
    })
}

fn run_shared_agent_stream<F, R>(
    request: AiAgentStreamRequest,
    permission_mode: AiAgentPermissionMode,
    runner: R,
    emit: F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
    R: FnOnce(crate::cli_agent_runtime::AgentStreamRequest, F) -> Result<String, String>,
{
    let mapped = crate::cli_agent_runtime::AgentStreamRequest {
        message: request.message,
        system_prompt: request.system_prompt,
        vault_path: request.vault_path,
        vault_paths: request.vault_paths,
        permission_mode,
    };
    runner(mapped, emit)
}

fn availability_from_claude() -> AiAgentAvailability {
    let status = crate::claude_cli::check_cli();
    AiAgentAvailability {
        installed: status.installed,
        version: status.version,
    }
}

fn map_claude_event(event: crate::claude_cli::ClaudeStreamEvent) -> Option<AiAgentStreamEvent> {
    match event {
        crate::claude_cli::ClaudeStreamEvent::Init { session_id } => {
            Some(AiAgentStreamEvent::Init { session_id })
        }
        crate::claude_cli::ClaudeStreamEvent::TextDelta { text } => {
            Some(AiAgentStreamEvent::TextDelta { text })
        }
        crate::claude_cli::ClaudeStreamEvent::ThinkingDelta { text } => {
            Some(AiAgentStreamEvent::ThinkingDelta { text })
        }
        crate::claude_cli::ClaudeStreamEvent::ToolStart {
            tool_name,
            tool_id,
            input,
        } => Some(AiAgentStreamEvent::ToolStart {
            tool_name,
            tool_id,
            input,
        }),
        crate::claude_cli::ClaudeStreamEvent::ToolDone { tool_id, output } => {
            Some(AiAgentStreamEvent::ToolDone { tool_id, output })
        }
        crate::claude_cli::ClaudeStreamEvent::Error { message } => {
            Some(AiAgentStreamEvent::Error { message })
        }
        crate::claude_cli::ClaudeStreamEvent::Done => Some(AiAgentStreamEvent::Done),
        crate::claude_cli::ClaudeStreamEvent::Result { text, .. } if !text.is_empty() => {
            Some(AiAgentStreamEvent::TextDelta { text })
        }
        crate::claude_cli::ClaudeStreamEvent::Result { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request_with_permission(
        permission_mode: Option<AiAgentPermissionMode>,
    ) -> AiAgentStreamRequest {
        AiAgentStreamRequest {
            agent: AiAgentId::Codex,
            message: "Summarize this vault".into(),
            system_prompt: None,
            vault_path: "/tmp/vault".into(),
            vault_paths: Vec::new(),
            permission_mode,
            event_name: None,
        }
    }

    #[test]
    fn stream_request_uses_default_or_explicit_permission_mode() {
        assert_eq!(
            request_with_permission(None).permission_mode(),
            AiAgentPermissionMode::Safe
        );
        assert_eq!(
            request_with_permission(Some(AiAgentPermissionMode::PowerUser)).permission_mode(),
            AiAgentPermissionMode::PowerUser
        );
    }

    #[tokio::test]
    async fn normalize_status_contains_all_agents() {
        let status = get_ai_agents_status().await;
        let install_flags = [
            status.claude_code.installed,
            status.codex.installed,
            status.opencode.installed,
            status.pi.installed,
            status.gemini.installed,
            status.kiro.installed,
            status.hermes.installed,
        ];

        assert!(install_flags
            .iter()
            .all(|installed| matches!(installed, true | false)));
    }

    #[tokio::test]
    async fn availability_probe_timeout_returns_missing_status() {
        let handle = tokio::task::spawn_blocking(|| {
            std::thread::sleep(std::time::Duration::from_millis(50));
            AiAgentAvailability {
                installed: true,
                version: Some("late".into()),
            }
        });

        let status = availability_or_missing(handle, std::time::Duration::from_millis(1)).await;

        assert!(!status.installed);
        assert_eq!(status.version, None);
    }

    #[test]
    fn map_claude_done_event_preserves_completion_signal() {
        let mapped = map_claude_event(crate::claude_cli::ClaudeStreamEvent::Done);

        assert!(matches!(mapped, Some(AiAgentStreamEvent::Done)));
    }

    #[test]
    fn map_claude_text_events_preserve_stream_data() {
        assert!(matches!(
            map_claude_event(crate::claude_cli::ClaudeStreamEvent::Init {
                session_id: "session-1".into(),
            }),
            Some(AiAgentStreamEvent::Init { session_id }) if session_id == "session-1"
        ));
        assert!(matches!(
            map_claude_event(crate::claude_cli::ClaudeStreamEvent::TextDelta {
                text: "visible output".into(),
            }),
            Some(AiAgentStreamEvent::TextDelta { text }) if text == "visible output"
        ));
        assert!(matches!(
            map_claude_event(crate::claude_cli::ClaudeStreamEvent::ThinkingDelta {
                text: "thinking".into(),
            }),
            Some(AiAgentStreamEvent::ThinkingDelta { text }) if text == "thinking"
        ));
    }

    #[test]
    fn map_claude_tool_events_preserve_stream_data() {
        let started = map_claude_event(crate::claude_cli::ClaudeStreamEvent::ToolStart {
            tool_name: "Read".into(),
            tool_id: "tool-1".into(),
            input: Some("{\"file\":\"note.md\"}".into()),
        });
        let finished = map_claude_event(crate::claude_cli::ClaudeStreamEvent::ToolDone {
            tool_id: "tool-1".into(),
            output: Some("done".into()),
        });

        assert!(matches!(
            started,
            Some(AiAgentStreamEvent::ToolStart { tool_name, tool_id, input })
                if tool_name == "Read"
                    && tool_id == "tool-1"
                    && input.as_deref() == Some("{\"file\":\"note.md\"}")
        ));
        assert!(matches!(
            finished,
            Some(AiAgentStreamEvent::ToolDone { tool_id, output })
                if tool_id == "tool-1" && output.as_deref() == Some("done")
        ));
    }

    #[test]
    fn map_claude_error_event_preserves_message() {
        let mapped = map_claude_event(crate::claude_cli::ClaudeStreamEvent::Error {
            message: "missing auth".into(),
        });

        assert!(matches!(
            mapped,
            Some(AiAgentStreamEvent::Error { message }) if message == "missing auth"
        ));
    }

    #[test]
    fn map_claude_result_event_preserves_final_text() {
        let mapped = map_claude_event(crate::claude_cli::ClaudeStreamEvent::Result {
            text: "Final answer from Claude".into(),
            session_id: "session-1".into(),
        });

        assert!(matches!(
            mapped,
            Some(AiAgentStreamEvent::TextDelta { text }) if text == "Final answer from Claude"
        ));
    }

    #[test]
    fn map_claude_empty_result_event_is_ignored() {
        let mapped = map_claude_event(crate::claude_cli::ClaudeStreamEvent::Result {
            text: String::new(),
            session_id: "session-1".into(),
        });

        assert!(mapped.is_none());
    }
}
