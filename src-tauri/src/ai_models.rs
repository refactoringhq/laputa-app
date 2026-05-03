use crate::ai_agents::AiAgentStreamEvent;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiModelProviderKind {
    OpenAi,
    Anthropic,
    OpenAiCompatible,
    Ollama,
    LmStudio,
    OpenRouter,
    Gemini,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiModelApiKeyStorage {
    None,
    Env,
    LocalFile,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AiModelCapabilities {
    pub streaming: bool,
    pub tools: bool,
    pub vision: bool,
    pub json_mode: bool,
    pub reasoning: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AiModelDefinition {
    pub id: String,
    pub display_name: Option<String>,
    pub context_window: Option<u32>,
    pub max_output_tokens: Option<u32>,
    pub capabilities: AiModelCapabilities,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AiModelProvider {
    pub id: String,
    pub name: String,
    pub kind: AiModelProviderKind,
    pub base_url: Option<String>,
    pub api_key_storage: Option<AiModelApiKeyStorage>,
    pub api_key_env_var: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
    pub models: Vec<AiModelDefinition>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiModelStreamRequest {
    pub provider: AiModelProvider,
    pub model_id: String,
    pub message: String,
    pub system_prompt: Option<String>,
    pub api_key_override: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiModelProviderTestRequest {
    pub provider: AiModelProvider,
    pub model_id: String,
    pub api_key_override: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
struct AiProviderSecrets {
    provider_api_keys: BTreeMap<String, String>,
}

pub fn normalize_ai_model_providers(
    providers: Option<Vec<AiModelProvider>>,
) -> Option<Vec<AiModelProvider>> {
    let normalized = providers?
        .into_iter()
        .filter_map(normalize_ai_model_provider)
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn normalize_ai_model_provider(mut provider: AiModelProvider) -> Option<AiModelProvider> {
    provider.id = provider.id.trim().to_ascii_lowercase();
    provider.name = provider.name.trim().to_string();
    provider.base_url = normalize_optional_string(provider.base_url);
    provider.api_key_env_var = normalize_optional_string(provider.api_key_env_var);
    provider.api_key_storage = normalize_api_key_storage(&provider);
    provider.models = normalized_models(provider.models);

    is_valid_provider(&provider).then_some(provider)
}

fn normalize_api_key_storage(provider: &AiModelProvider) -> Option<AiModelApiKeyStorage> {
    match provider.api_key_storage {
        Some(AiModelApiKeyStorage::LocalFile) => Some(AiModelApiKeyStorage::LocalFile),
        Some(AiModelApiKeyStorage::Env) | None if provider.api_key_env_var.is_some() => {
            Some(AiModelApiKeyStorage::Env)
        }
        _ => Some(AiModelApiKeyStorage::None),
    }
}

fn normalized_models(models: Vec<AiModelDefinition>) -> Vec<AiModelDefinition> {
    models
        .into_iter()
        .filter_map(|mut model| {
            model.id = model.id.trim().to_string();
            model.display_name = normalize_optional_string(model.display_name);
            (!model.id.is_empty()).then_some(model)
        })
        .collect()
}

fn is_valid_provider(provider: &AiModelProvider) -> bool {
    !provider.id.is_empty() && !provider.name.is_empty() && !provider.models.is_empty()
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|candidate| candidate.trim().to_string())
        .filter(|candidate| !candidate.is_empty())
}

pub fn run_ai_model_stream<F>(request: AiModelStreamRequest, mut emit: F) -> Result<String, String>
where
    F: FnMut(AiAgentStreamEvent),
{
    emit(AiAgentStreamEvent::Init {
        session_id: format!("api-{}", uuid::Uuid::new_v4()),
    });

    let text = send_model_message(&request)?;

    emit(AiAgentStreamEvent::TextDelta { text });
    emit(AiAgentStreamEvent::Done);
    Ok(String::new())
}

pub fn test_ai_model_provider(request: AiModelProviderTestRequest) -> Result<String, String> {
    let request = AiModelStreamRequest {
        provider: request.provider,
        model_id: request.model_id,
        message: "Reply with exactly OK.".into(),
        system_prompt: Some(
            "You are testing whether this model endpoint is reachable. Reply with exactly OK."
                .into(),
        ),
        api_key_override: normalize_optional_string(request.api_key_override),
    };
    send_model_message(&request)
}

fn send_model_message(request: &AiModelStreamRequest) -> Result<String, String> {
    match request.provider.kind {
        AiModelProviderKind::Anthropic => send_anthropic_message(request),
        _ => send_openai_compatible_message(request),
    }
}

fn send_openai_compatible_message(request: &AiModelStreamRequest) -> Result<String, String> {
    let endpoint = format!("{}/chat/completions", normalized_base_url(request)?);
    let mut messages = Vec::new();
    if let Some(system_prompt) = non_empty_option(request.system_prompt.as_deref()) {
        messages.push(serde_json::json!({ "role": "system", "content": system_prompt }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": request.message }));

    let payload = serde_json::json!({
        "model": request.model_id,
        "messages": messages,
        "stream": false
    });
    let json = send_json_request(request, endpoint, payload)?;
    extract_openai_text(&json)
}

fn send_anthropic_message(request: &AiModelStreamRequest) -> Result<String, String> {
    let endpoint = format!("{}/messages", normalized_base_url(request)?);
    let mut payload = serde_json::json!({
        "model": request.model_id,
        "max_tokens": selected_max_tokens(request),
        "messages": [{ "role": "user", "content": request.message }]
    });

    if let Some(system_prompt) = non_empty_option(request.system_prompt.as_deref()) {
        payload["system"] = serde_json::Value::String(system_prompt.to_string());
    }

    let json = send_json_request(request, endpoint, payload)?;
    extract_anthropic_text(&json)
}

fn selected_max_tokens(request: &AiModelStreamRequest) -> u32 {
    request
        .provider
        .models
        .iter()
        .find(|model| model.id == request.model_id)
        .and_then(|model| model.max_output_tokens)
        .unwrap_or(4096)
}

fn normalized_base_url(request: &AiModelStreamRequest) -> Result<String, String> {
    let fallback = match request.provider.kind {
        AiModelProviderKind::OpenAi => "https://api.openai.com/v1",
        AiModelProviderKind::Anthropic => "https://api.anthropic.com/v1",
        AiModelProviderKind::OpenRouter => "https://openrouter.ai/api/v1",
        AiModelProviderKind::Gemini => "https://generativelanguage.googleapis.com/v1beta/openai",
        AiModelProviderKind::Ollama => "http://localhost:11434/v1",
        AiModelProviderKind::LmStudio => "http://127.0.0.1:1234/v1",
        AiModelProviderKind::OpenAiCompatible => "",
    };
    let base = request
        .provider
        .base_url
        .as_deref()
        .and_then(non_empty_str)
        .unwrap_or(fallback)
        .trim_end_matches('/');
    if base.is_empty() {
        return Err("Custom API providers need a base URL.".into());
    }
    Ok(base.to_string())
}

fn send_json_request(
    request: &AiModelStreamRequest,
    endpoint: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))?;
    let builder = client.post(endpoint).json(&payload);
    let builder = apply_auth_headers(builder, request)?;
    let builder = apply_provider_headers(builder, request);
    let response = send_provider_request(builder)?;
    let status = response.status();
    let text = response
        .text()
        .map_err(|error| format!("Failed to read AI provider response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "AI provider returned {status}: {}",
            truncate_error(&text)
        ));
    }
    serde_json::from_str(&text)
        .map_err(|error| format!("Failed to parse AI provider response: {error}"))
}

fn apply_auth_headers(
    builder: reqwest::blocking::RequestBuilder,
    request: &AiModelStreamRequest,
) -> Result<reqwest::blocking::RequestBuilder, String> {
    let Some(api_key) = api_key_from_provider(request)? else {
        return Ok(builder);
    };

    Ok(match request.provider.kind {
        AiModelProviderKind::Anthropic => builder.header("x-api-key", api_key),
        _ => builder.bearer_auth(api_key),
    })
}

fn apply_provider_headers(
    mut builder: reqwest::blocking::RequestBuilder,
    request: &AiModelStreamRequest,
) -> reqwest::blocking::RequestBuilder {
    if matches!(request.provider.kind, AiModelProviderKind::Anthropic) {
        builder = builder.header("anthropic-version", "2023-06-01");
    }
    for (key, value) in safe_custom_headers(request) {
        builder = builder.header(key, value);
    }
    builder
}

fn safe_custom_headers(request: &AiModelStreamRequest) -> Vec<(&String, &String)> {
    request
        .provider
        .headers
        .as_ref()
        .into_iter()
        .flat_map(|headers| headers.iter())
        .filter(|(key, value)| {
            !key.eq_ignore_ascii_case("authorization") && non_empty_option(Some(value)).is_some()
        })
        .collect()
}

fn send_provider_request(
    builder: reqwest::blocking::RequestBuilder,
) -> Result<reqwest::blocking::Response, String> {
    builder
        .send()
        .map_err(|error| format!("AI provider request failed: {error}"))
}

pub fn save_provider_api_key(provider_id: String, api_key: String) -> Result<(), String> {
    let provider_id = normalize_secret_provider_id(&provider_id)?;
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("API key cannot be empty.".into());
    }
    let path = secrets_path()?;
    let mut secrets = read_secrets_at(&path)?;
    secrets.provider_api_keys.insert(provider_id, api_key);
    write_secrets_at(&path, &secrets)
}

pub fn delete_provider_api_key(provider_id: String) -> Result<(), String> {
    let provider_id = normalize_secret_provider_id(&provider_id)?;
    let path = secrets_path()?;
    let mut secrets = read_secrets_at(&path)?;
    secrets.provider_api_keys.remove(&provider_id);
    write_secrets_at(&path, &secrets)
}

fn normalize_secret_provider_id(provider_id: &str) -> Result<String, String> {
    let provider_id = provider_id.trim().to_ascii_lowercase();
    if provider_id.is_empty() {
        Err("Provider ID cannot be empty.".into())
    } else {
        Ok(provider_id)
    }
}

fn secrets_path() -> Result<std::path::PathBuf, String> {
    crate::settings::preferred_app_config_path("ai-provider-secrets.json")
}

fn read_secrets_at(path: &Path) -> Result<AiProviderSecrets, String> {
    if !path.exists() {
        return Ok(AiProviderSecrets::default());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read AI provider secrets: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse AI provider secrets: {error}"))
}

fn write_secrets_at(path: &Path, secrets: &AiProviderSecrets) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create AI provider secrets directory: {error}"))?;
    }
    let json = serde_json::to_string_pretty(secrets)
        .map_err(|error| format!("Failed to serialize AI provider secrets: {error}"))?;
    write_secret_file(path, json)
}

#[cfg(unix)]
fn write_secret_file(path: &Path, content: String) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    use std::os::unix::fs::PermissionsExt;

    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| format!("Failed to open AI provider secrets file: {error}"))?;
    file.write_all(content.as_bytes())
        .map_err(|error| format!("Failed to write AI provider secrets: {error}"))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Failed to secure AI provider secrets file: {error}"))
}

#[cfg(not(unix))]
fn write_secret_file(path: &Path, content: String) -> Result<(), String> {
    fs::write(path, content)
        .map_err(|error| format!("Failed to write AI provider secrets: {error}"))
}

fn api_key_from_local_file(request: &AiModelStreamRequest) -> Result<Option<String>, String> {
    let secrets = read_secrets_at(&secrets_path()?)?;
    let api_key = secrets
        .provider_api_keys
        .get(&request.provider.id)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if api_key.is_none() {
        return Err(format!(
            "No local API key is saved for {}.",
            request.provider.name
        ));
    }
    Ok(api_key)
}

fn api_key_from_env(request: &AiModelStreamRequest) -> Result<Option<String>, String> {
    let Some(name) = request
        .provider
        .api_key_env_var
        .as_deref()
        .and_then(non_empty_str)
    else {
        return Ok(None);
    };

    std::env::var(name)
        .map(Some)
        .map_err(|_| format!("Environment variable {name} is not set for this AI provider."))
}

fn api_key_from_provider(request: &AiModelStreamRequest) -> Result<Option<String>, String> {
    if let Some(api_key) = request
        .api_key_override
        .as_deref()
        .and_then(non_empty_str)
        .map(str::to_string)
    {
        return Ok(Some(api_key));
    }

    match request.provider.api_key_storage {
        Some(AiModelApiKeyStorage::LocalFile) => api_key_from_local_file(request),
        Some(AiModelApiKeyStorage::Env) => api_key_from_env(request),
        _ => Ok(None),
    }
}

fn extract_openai_text(json: &serde_json::Value) -> Result<String, String> {
    json["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_string)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| "AI provider response did not include assistant text.".to_string())
}

fn extract_anthropic_text(json: &serde_json::Value) -> Result<String, String> {
    let text = json["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|block| block["text"].as_str())
        .collect::<Vec<_>>()
        .join("");
    if text.trim().is_empty() {
        Err("Anthropic response did not include assistant text.".into())
    } else {
        Ok(text)
    }
}

fn non_empty_option(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn non_empty_str(value: &str) -> Option<&str> {
    non_empty_option(Some(value))
}

fn truncate_error(value: &str) -> String {
    const MAX_ERROR_LENGTH: usize = 600;
    if value.len() <= MAX_ERROR_LENGTH {
        return value.to_string();
    }
    format!("{}...", &value[..MAX_ERROR_LENGTH])
}
