use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiAgentId {
    ClaudeCode,
    Codex,
    Opencode,
    Pi,
    Gemini,
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
    pub permission_mode: Option<AiAgentPermissionMode>,
}

impl AiAgentStreamRequest {
    fn permission_mode(&self) -> AiAgentPermissionMode {
        self.permission_mode.unwrap_or_default()
    }
}

pub fn get_ai_agents_status() -> AiAgentsStatus {
    AiAgentsStatus {
        claude_code: availability_from_claude(),
        codex: crate::codex_cli::check_cli(),
        opencode: crate::opencode_cli::check_cli(),
        pi: crate::pi_cli::check_cli(),
        gemini: crate::gemini_cli::check_cli(),
    }
}

pub fn run_ai_agent_stream<F>(request: AiAgentStreamRequest, mut emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let permission_mode = request.permission_mode();
    match request.agent {
        AiAgentId::ClaudeCode => {
            let mapped = crate::claude_cli::AgentStreamRequest {
                message: request.message,
                system_prompt: request.system_prompt,
                vault_path: request.vault_path,
                permission_mode,
            };
            crate::claude_cli::run_agent_stream(mapped, |event| {
                if let Some(mapped_event) = map_claude_event(event) {
                    emit(mapped_event);
                }
            })
        }
        AiAgentId::Codex => {
            let mapped = crate::codex_cli::AgentStreamRequest {
                message: request.message,
                system_prompt: request.system_prompt,
                vault_path: request.vault_path,
                permission_mode,
            };
            crate::codex_cli::run_agent_stream(mapped, emit)
        }
        AiAgentId::Opencode => {
            let mapped = crate::opencode_cli::AgentStreamRequest {
                message: request.message,
                system_prompt: request.system_prompt,
                vault_path: request.vault_path,
                permission_mode,
            };
            crate::opencode_cli::run_agent_stream(mapped, emit)
        }
        AiAgentId::Pi => {
            let mapped = crate::pi_cli::AgentStreamRequest {
                message: request.message,
                system_prompt: request.system_prompt,
                vault_path: request.vault_path,
                permission_mode,
            };
            crate::pi_cli::run_agent_stream(mapped, emit)
        }
        AiAgentId::Gemini => {
            let mapped = crate::gemini_cli::AgentStreamRequest {
                message: request.message,
                system_prompt: request.system_prompt,
                vault_path: request.vault_path,
                permission_mode,
            };
            crate::gemini_cli::run_agent_stream(mapped, emit)
        }
    }
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
            permission_mode,
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

    #[test]
    fn normalize_status_contains_all_agents() {
        let status = get_ai_agents_status();
        let install_flags = [
            status.claude_code.installed,
            status.codex.installed,
            status.opencode.installed,
            status.pi.installed,
            status.gemini.installed,
        ];

        assert!(install_flags
            .iter()
            .all(|installed| matches!(installed, true | false)));
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
