use crate::ai_agents::AiAgentStreamEvent;
use crate::ai_models::{AiModelProviderKind, AiModelStreamRequest};
use std::path::{Path, PathBuf};

const CREATE_NOTE_TOOL_NAME: &str = "create_note";
const CREATE_NOTE_TOOL_JSON: &str = r#"{
  "type": "function",
  "function": {
    "name": "create_note",
    "description": "Create a new markdown note inside the active Tolaria vault without overwriting existing files.",
    "parameters": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Relative path inside the vault, or an absolute path inside the active vault. Must end in .md."
        },
        "content": {
          "type": "string",
          "description": "Full markdown note content, including YAML frontmatter and H1 when needed."
        },
        "title": {
          "type": "string",
          "description": "Optional title used only when content is omitted."
        },
        "type": {
          "type": "string",
          "description": "Optional note type used only when content is omitted."
        },
        "is_a": {
          "type": "string",
          "description": "Legacy alias for type, used only when content is omitted."
        },
        "vaultPath": {
          "type": "string",
          "description": "Optional target vault root when multiple vaults are active."
        }
      },
      "required": ["path"],
      "additionalProperties": false
    }
  }
}"#;

struct OpenAiToolCall {
    id: String,
    name: String,
    arguments: serde_json::Value,
    raw_arguments: String,
}

struct CreatedNoteToolResult {
    summary: String,
    output: String,
}

pub(crate) fn openai_chat_payload(request: &AiModelStreamRequest) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "model": request.model_id,
        "messages": openai_chat_messages(request),
        "stream": false
    });
    if should_offer_openai_tools(request) {
        payload["tools"] = serde_json::Value::Array(vec![openai_create_note_tool()]);
        payload["tool_choice"] = serde_json::Value::String("auto".into());
    }
    payload
}

pub(crate) fn execute_openai_tool_calls<F>(
    request: &AiModelStreamRequest,
    json: &serde_json::Value,
    emit: F,
) -> Result<Option<String>, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let tool_calls = openai_tool_calls(json)?;
    if tool_calls.is_empty() {
        return Ok(None);
    }
    run_openai_tool_calls(request, &tool_calls, emit).map(Some)
}

fn openai_chat_messages(request: &AiModelStreamRequest) -> Vec<serde_json::Value> {
    let mut messages = Vec::new();
    if let Some(system_prompt) = non_empty_option(request.system_prompt.as_deref()) {
        messages.push(serde_json::json!({ "role": "system", "content": system_prompt }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": request.message }));
    messages
}

fn should_offer_openai_tools(request: &AiModelStreamRequest) -> bool {
    let has_active_vault = non_empty_option(request.vault_path.as_deref()).is_some();
    has_active_vault
        && (request.provider.kind == AiModelProviderKind::OpenAi
            || selected_model_supports_tools(request))
}

fn selected_model_supports_tools(request: &AiModelStreamRequest) -> bool {
    request
        .provider
        .models
        .iter()
        .find(|model| model.id == request.model_id)
        .is_some_and(|model| model.capabilities.tools)
}

fn openai_create_note_tool() -> serde_json::Value {
    serde_json::from_str(CREATE_NOTE_TOOL_JSON).expect("create_note tool schema must be valid JSON")
}

fn run_openai_tool_calls<F>(
    request: &AiModelStreamRequest,
    tool_calls: &[OpenAiToolCall],
    mut emit: F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    let mut summaries = Vec::new();
    for tool_call in tool_calls {
        summaries.push(execute_openai_tool_call(request, tool_call, &mut emit)?);
    }
    Ok(summaries.join("\n"))
}

fn execute_openai_tool_call<F>(
    request: &AiModelStreamRequest,
    tool_call: &OpenAiToolCall,
    emit: &mut F,
) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    if tool_call.name != CREATE_NOTE_TOOL_NAME {
        return Err(format!(
            "AI provider requested unsupported tool: {}",
            tool_call.name
        ));
    }

    emit(AiAgentStreamEvent::ToolStart {
        tool_name: CREATE_NOTE_TOOL_NAME.into(),
        tool_id: tool_call.id.clone(),
        input: Some(tool_call.raw_arguments.clone()),
    });

    match create_note_from_tool_args(request, &tool_call.arguments) {
        Ok(result) => {
            emit(AiAgentStreamEvent::ToolDone {
                tool_id: tool_call.id.clone(),
                output: Some(result.output),
            });
            Ok(result.summary)
        }
        Err(error) => {
            emit(AiAgentStreamEvent::ToolDone {
                tool_id: tool_call.id.clone(),
                output: Some(format!("Error: {error}")),
            });
            Err(error)
        }
    }
}

fn openai_tool_calls(json: &serde_json::Value) -> Result<Vec<OpenAiToolCall>, String> {
    let Some(calls) = json["choices"][0]["message"]["tool_calls"].as_array() else {
        return Ok(Vec::new());
    };

    calls
        .iter()
        .enumerate()
        .map(|(index, call)| openai_tool_call(index, call))
        .collect()
}

fn openai_tool_call(index: usize, call: &serde_json::Value) -> Result<OpenAiToolCall, String> {
    let function = &call["function"];
    let name = function["name"]
        .as_str()
        .ok_or_else(|| "AI provider tool call did not include a function name.".to_string())?
        .to_string();
    let (arguments, raw_arguments) = parse_tool_arguments(&function["arguments"])?;
    let id = call["id"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("tool_call_{index}"));
    Ok(OpenAiToolCall {
        id,
        name,
        arguments,
        raw_arguments,
    })
}

fn parse_tool_arguments(value: &serde_json::Value) -> Result<(serde_json::Value, String), String> {
    if let Some(raw) = value.as_str() {
        let parsed = serde_json::from_str(raw)
            .map_err(|error| format!("Failed to parse AI tool arguments: {error}"))?;
        return Ok((parsed, raw.to_string()));
    }
    if value.is_object() {
        let raw = serde_json::to_string(value)
            .map_err(|error| format!("Failed to serialize AI tool arguments: {error}"))?;
        return Ok((value.clone(), raw));
    }
    Ok((serde_json::json!({}), "{}".into()))
}

fn create_note_from_tool_args(
    request: &AiModelStreamRequest,
    args: &serde_json::Value,
) -> Result<CreatedNoteToolResult, String> {
    let note_path = required_tool_string(args, "path")?;
    let content = create_note_tool_content(args, note_path);
    let vault_path = tool_vault_path(request, args)?;
    crate::commands::create_note_content(
        PathBuf::from(note_path),
        content,
        Some(PathBuf::from(vault_path)),
    )?;
    let output = serde_json::json!({
        "path": note_path,
        "vaultPath": vault_path,
    })
    .to_string();
    Ok(CreatedNoteToolResult {
        summary: format!("Created note: {note_path}"),
        output,
    })
}

fn tool_vault_path<'a>(
    request: &'a AiModelStreamRequest,
    args: &'a serde_json::Value,
) -> Result<&'a str, String> {
    if let Some(vault_path) = string_arg(args, "vaultPath") {
        return active_tool_vault_path(request, vault_path);
    }
    request
        .vault_path
        .as_deref()
        .and_then(non_empty_str)
        .ok_or_else(|| "No active vault is available for create_note.".to_string())
}

fn active_tool_vault_path<'a>(
    request: &'a AiModelStreamRequest,
    vault_path: &'a str,
) -> Result<&'a str, String> {
    if active_vault_paths(request).any(|active| active == vault_path) {
        Ok(vault_path)
    } else {
        Err(format!("Vault is not active in Tolaria: {vault_path}"))
    }
}

fn active_vault_paths(request: &AiModelStreamRequest) -> impl Iterator<Item = &str> {
    request
        .vault_path
        .as_deref()
        .into_iter()
        .chain(request.vault_paths.iter().map(String::as_str))
        .filter_map(non_empty_str)
}

fn create_note_tool_content(args: &serde_json::Value, note_path: &str) -> String {
    if let Some(content) = content_arg(args, "content") {
        return content.to_string();
    }
    let title = string_arg(args, "title")
        .map(str::to_string)
        .unwrap_or_else(|| fallback_note_title(note_path));
    let note_type = string_arg(args, "type")
        .or_else(|| string_arg(args, "is_a"))
        .unwrap_or("Note");
    let note_type_yaml = serde_json::to_string(note_type).unwrap_or_else(|_| "\"Note\"".into());
    format!("---\ntype: {note_type_yaml}\n---\n\n# {title}\n")
}

fn fallback_note_title(note_path: &str) -> String {
    let normalized = note_path.replace('\\', "/");
    Path::new(&normalized)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|title| !title.trim().is_empty())
        .unwrap_or("Untitled")
        .to_string()
}

fn required_tool_string<'a>(args: &'a serde_json::Value, key: &str) -> Result<&'a str, String> {
    string_arg(args, key).ok_or_else(|| format!("create_note requires {key}."))
}

fn string_arg<'a>(args: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    args[key].as_str().and_then(non_empty_str)
}

fn content_arg<'a>(args: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    args[key]
        .as_str()
        .filter(|content| !content.trim().is_empty())
}

fn non_empty_option(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn non_empty_str(value: &str) -> Option<&str> {
    non_empty_option(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_models::{
        AiModelApiKeyStorage, AiModelCapabilities, AiModelDefinition, AiModelProvider,
    };
    use serde_json::json;
    use std::fs;

    const CREATED_NOTE_PATH: &str = "nota-longa-teste-gerada-2.md";
    const CREATED_NOTE_CONTENT: &str = "---\ntype: Note\n---\n\n# Nota longa de teste - gerada 2\n";

    fn request(vault_path: String) -> AiModelStreamRequest {
        request_with_provider(provider(), Some(vault_path), Vec::new())
    }

    fn request_with_provider(
        provider: AiModelProvider,
        vault_path: Option<String>,
        vault_paths: Vec<String>,
    ) -> AiModelStreamRequest {
        AiModelStreamRequest {
            provider,
            model_id: "gpt-5-nano".into(),
            message: "Create the note".into(),
            system_prompt: Some("Use create_note for new notes.".into()),
            vault_path,
            vault_paths,
            api_key_override: None,
            event_name: None,
        }
    }

    fn provider() -> AiModelProvider {
        AiModelProvider {
            id: "openai".into(),
            name: "OpenAI".into(),
            kind: AiModelProviderKind::OpenAi,
            base_url: Some("https://api.openai.com/v1".into()),
            api_key_storage: Some(AiModelApiKeyStorage::LocalFile),
            api_key_env_var: None,
            headers: None,
            models: vec![AiModelDefinition {
                id: "gpt-5-nano".into(),
                display_name: None,
                context_window: None,
                max_output_tokens: None,
                capabilities: AiModelCapabilities {
                    streaming: false,
                    tools: false,
                    vision: false,
                    json_mode: false,
                    reasoning: false,
                },
            }],
        }
    }

    fn create_note_response() -> serde_json::Value {
        tool_call_response(json!({
            "id": "call_create",
            "function": {
                "name": CREATE_NOTE_TOOL_NAME,
                "arguments": serde_json::to_string(&json!({
                    "path": CREATED_NOTE_PATH,
                    "content": CREATED_NOTE_CONTENT
                })).unwrap()
            }
        }))
    }

    fn tool_call_response(tool_call: serde_json::Value) -> serde_json::Value {
        json!({
            "choices": [{
                "message": {
                    "tool_calls": [tool_call]
                }
            }]
        })
    }

    fn create_note_response_with_args(arguments: serde_json::Value) -> serde_json::Value {
        tool_call_response(json!({
            "function": {
                "name": CREATE_NOTE_TOOL_NAME,
                "arguments": arguments,
            }
        }))
    }

    fn create_note_error(arguments: serde_json::Value) -> String {
        let dir = tempfile::tempdir().unwrap();
        let request = request(dir.path().to_string_lossy().into_owned());

        execute_openai_tool_calls(&request, &create_note_response_with_args(arguments), |_| {})
            .unwrap_err()
    }

    fn assert_note_created(vault_path: &Path) {
        let actual = fs::read_to_string(vault_path.join(CREATED_NOTE_PATH)).unwrap();
        assert_eq!(actual, CREATED_NOTE_CONTENT);
    }

    fn assert_summary(summary: Option<String>) {
        assert_eq!(
            summary.as_deref(),
            Some("Created note: nota-longa-teste-gerada-2.md"),
        );
    }

    fn assert_tool_events(events: &[AiAgentStreamEvent]) {
        assert!(matches!(
            &events[0],
            AiAgentStreamEvent::ToolStart { tool_name, tool_id, input: Some(input) }
                if tool_name == CREATE_NOTE_TOOL_NAME && tool_id == "call_create" && input.contains(CREATED_NOTE_PATH)
        ));
        assert!(matches!(
            &events[1],
            AiAgentStreamEvent::ToolDone { tool_id, output: Some(output) }
                if tool_id == "call_create" && output.contains(CREATED_NOTE_PATH)
        ));
    }

    #[test]
    fn openai_payload_offers_create_note_when_active_vault_is_loaded() {
        let dir = tempfile::tempdir().unwrap();
        let payload = openai_chat_payload(&request(dir.path().to_string_lossy().into_owned()));

        assert!(payload["tools"][0]["function"]["name"] == CREATE_NOTE_TOOL_NAME);
    }

    #[test]
    fn openai_payload_offers_create_note_for_tool_capable_custom_models() {
        let dir = tempfile::tempdir().unwrap();
        let mut provider = provider();
        provider.kind = AiModelProviderKind::OpenAiCompatible;
        provider.models[0].capabilities.tools = true;
        let request = request_with_provider(
            provider,
            Some(dir.path().to_string_lossy().into_owned()),
            vec![],
        );

        let payload = openai_chat_payload(&request);

        assert!(payload["tools"][0]["function"]["name"] == CREATE_NOTE_TOOL_NAME);
    }

    #[test]
    fn openai_payload_skips_create_note_when_no_active_vault_is_loaded() {
        let payload = openai_chat_payload(&request_with_provider(provider(), None, Vec::new()));

        assert!(payload.get("tools").is_none());
        assert!(payload.get("tool_choice").is_none());
    }

    #[test]
    fn execute_openai_tool_calls_returns_none_without_tool_calls() {
        let dir = tempfile::tempdir().unwrap();
        let request = request(dir.path().to_string_lossy().into_owned());

        let summary = execute_openai_tool_calls(
            &request,
            &json!({ "choices": [{ "message": { "content": "No tools" } }] }),
            |_| {},
        )
        .unwrap();

        assert_eq!(summary, None);
    }

    #[test]
    fn executes_openai_create_note_tool_call_inside_active_vault() {
        let dir = tempfile::tempdir().unwrap();
        let request = request(dir.path().to_string_lossy().into_owned());
        let mut events = Vec::new();

        let summary = execute_openai_tool_calls(&request, &create_note_response(), |event| {
            events.push(event)
        })
        .unwrap();

        assert_note_created(dir.path());
        assert_summary(summary);
        assert_tool_events(&events);
    }

    #[test]
    fn executes_openai_create_note_with_object_arguments_and_selected_vault() {
        let primary = tempfile::tempdir().unwrap();
        let secondary = tempfile::tempdir().unwrap();
        let secondary_path = secondary.path().to_string_lossy().into_owned();
        let request = request_with_provider(
            provider(),
            Some(primary.path().to_string_lossy().into_owned()),
            vec![secondary_path.clone()],
        );
        let response = tool_call_response(json!({
            "function": {
                "name": CREATE_NOTE_TOOL_NAME,
                "arguments": {
                    "path": "Generated/fallback-note.md",
                    "is_a": "Project",
                    "vaultPath": secondary_path,
                }
            }
        }));

        let summary = execute_openai_tool_calls(&request, &response, |_| {}).unwrap();

        assert_eq!(
            fs::read_to_string(secondary.path().join("Generated/fallback-note.md")).unwrap(),
            "---\ntype: \"Project\"\n---\n\n# fallback-note\n",
        );
        assert_eq!(
            summary.as_deref(),
            Some("Created note: Generated/fallback-note.md")
        );
        assert!(!primary.path().join("Generated/fallback-note.md").exists());
    }

    #[test]
    fn execute_openai_tool_calls_rejects_unsupported_tool_before_running_it() {
        let dir = tempfile::tempdir().unwrap();
        let request = request(dir.path().to_string_lossy().into_owned());
        let response = tool_call_response(json!({
            "id": "call_delete",
            "function": {
                "name": "delete_note",
                "arguments": "{}",
            }
        }));
        let mut events = Vec::new();

        let error =
            execute_openai_tool_calls(&request, &response, |event| events.push(event)).unwrap_err();

        assert_eq!(error, "AI provider requested unsupported tool: delete_note");
        assert!(events.is_empty());
    }

    #[test]
    fn execute_openai_tool_calls_rejects_malformed_arguments() {
        let error = create_note_error(json!("{not-json"));

        assert!(error.contains("Failed to parse AI tool arguments"));
    }

    #[test]
    fn execute_openai_tool_calls_treats_non_object_arguments_as_empty() {
        let error = create_note_error(json!([]));

        assert_eq!(error, "create_note requires path.");
    }

    #[test]
    fn execute_openai_tool_calls_rejects_existing_note_without_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        let request = request(dir.path().to_string_lossy().into_owned());
        fs::write(dir.path().join("existing.md"), "# Existing\n").unwrap();
        let response = tool_call_response(json!({
            "function": {
                "name": CREATE_NOTE_TOOL_NAME,
                "arguments": serde_json::to_string(&json!({
                    "path": "existing.md",
                    "content": "# Replacement\n",
                })).unwrap(),
            }
        }));

        let error = execute_openai_tool_calls(&request, &response, |_| {}).unwrap_err();

        assert!(error.contains("already exists"));
        assert_eq!(
            fs::read_to_string(dir.path().join("existing.md")).unwrap(),
            "# Existing\n",
        );
    }

    #[test]
    fn execute_openai_tool_calls_requires_path() {
        let error = create_note_error(json!("{}"));

        assert_eq!(error, "create_note requires path.");
    }

    #[test]
    fn execute_openai_tool_calls_rejects_inactive_explicit_vault() {
        let active = tempfile::tempdir().unwrap();
        let inactive = tempfile::tempdir().unwrap();
        let request = request(active.path().to_string_lossy().into_owned());
        let response = tool_call_response(json!({
            "function": {
                "name": CREATE_NOTE_TOOL_NAME,
                "arguments": serde_json::to_string(&json!({
                    "path": "inactive.md",
                    "content": "# Inactive\n",
                    "vaultPath": inactive.path().to_string_lossy(),
                })).unwrap(),
            }
        }));

        let error = execute_openai_tool_calls(&request, &response, |_| {}).unwrap_err();

        assert!(error.starts_with("Vault is not active in Tolaria:"));
        assert!(!inactive.path().join("inactive.md").exists());
    }
}
