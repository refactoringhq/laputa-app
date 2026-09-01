use super::*;
use serde_json::json;

fn capabilities() -> AiModelCapabilities {
    AiModelCapabilities {
        streaming: true,
        tools: false,
        vision: false,
        json_mode: true,
        reasoning: false,
    }
}

fn model(id: &str) -> AiModelDefinition {
    AiModelDefinition {
        id: id.into(),
        display_name: Some(" Demo Model ".into()),
        context_window: Some(128_000),
        max_output_tokens: Some(8192),
        capabilities: capabilities(),
    }
}

fn provider(kind: AiModelProviderKind) -> AiModelProvider {
    AiModelProvider {
        id: " Demo ".into(),
        name: " Demo Provider ".into(),
        kind,
        base_url: Some(" https://example.com/v1/ ".into()),
        api_key_storage: None,
        api_key_env_var: Some(" DEMO_API_KEY ".into()),
        headers: None,
        models: vec![model(" demo-model "), model("  ")],
    }
}

fn request(provider: AiModelProvider) -> AiModelStreamRequest {
    AiModelStreamRequest {
        provider,
        model_id: "demo-model".into(),
        message: "Hello".into(),
        system_prompt: Some("  Be concise.  ".into()),
        vault_path: None,
        vault_paths: Vec::new(),
        api_key_override: None,
        event_name: None,
    }
}

#[test]
fn normalize_providers_trims_values_and_filters_invalid_entries() {
    let invalid = AiModelProvider {
        id: " ".into(),
        name: "Missing".into(),
        kind: AiModelProviderKind::OpenAiCompatible,
        base_url: None,
        api_key_storage: None,
        api_key_env_var: None,
        headers: None,
        models: vec![model("ignored")],
    };

    let providers = normalize_ai_model_providers(Some(vec![
        invalid,
        provider(AiModelProviderKind::OpenAiCompatible),
    ]))
    .expect("valid provider should remain");

    assert_eq!(providers.len(), 1);
    let normalized = &providers[0];
    assert_eq!(normalized.id, "demo");
    assert_eq!(normalized.name, "Demo Provider");
    assert_eq!(
        normalized.base_url.as_deref(),
        Some("https://example.com/v1/")
    );
    assert_eq!(normalized.api_key_env_var.as_deref(), Some("DEMO_API_KEY"));
    assert_eq!(normalized.api_key_storage, Some(AiModelApiKeyStorage::Env));
    assert_eq!(normalized.models.len(), 1);
    assert_eq!(normalized.models[0].id, "demo-model");
    assert_eq!(
        normalized.models[0].display_name.as_deref(),
        Some("Demo Model")
    );
}

#[test]
fn normalize_providers_returns_none_for_missing_or_empty_sets() {
    assert_eq!(normalize_ai_model_providers(None), None);
    assert_eq!(normalize_ai_model_providers(Some(Vec::new())), None);
}

#[test]
fn model_request_helpers_resolve_defaults_and_safe_headers() {
    let mut provider = provider(AiModelProviderKind::Anthropic);
    provider.base_url = None;
    provider.headers = Some(BTreeMap::from([
        ("Authorization".into(), "ignored".into()),
        ("X-Demo".into(), "demo".into()),
        ("X-Blank".into(), "   ".into()),
    ]));
    provider.models = vec![model("demo-model")];
    let request = request(provider);
    let headers = safe_custom_headers(&request)
        .into_iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect::<Vec<_>>();

    assert_eq!(
        normalized_base_url(&request).unwrap(),
        "https://api.anthropic.com/v1"
    );
    assert_eq!(selected_max_tokens(&request), 8192);
    assert_eq!(headers, vec![("X-Demo", "demo")]);
}

#[test]
fn request_builders_apply_auth_and_provider_headers() {
    let client = reqwest::blocking::Client::new();
    let mut anthropic_provider = provider(AiModelProviderKind::Anthropic);
    anthropic_provider.api_key_env_var = None;
    anthropic_provider.headers = Some(BTreeMap::from([
        ("Authorization".into(), "ignored".into()),
        ("X-Demo".into(), "demo".into()),
    ]));
    let mut anthropic_request = request(anthropic_provider);
    anthropic_request.api_key_override = Some(" secret ".into());

    let built = apply_provider_headers(
        apply_auth_headers(client.post("https://example.test"), &anthropic_request).unwrap(),
        &anthropic_request,
    )
    .build()
    .unwrap();

    let headers = built.headers();
    assert_eq!(
        (
            headers["x-api-key"].to_str().unwrap(),
            headers["anthropic-version"].to_str().unwrap(),
            headers["X-Demo"].to_str().unwrap(),
            headers.get("authorization").is_none(),
        ),
        ("secret", "2023-06-01", "demo", true),
    );

    let mut openai_provider = provider(AiModelProviderKind::OpenAi);
    openai_provider.api_key_env_var = None;
    let mut openai_request = request(openai_provider);
    openai_request.api_key_override = Some(" openai-secret ".into());
    let built = apply_auth_headers(client.post("https://example.test"), &openai_request)
        .unwrap()
        .build()
        .unwrap();

    assert_eq!(
        built.headers()["authorization"].to_str().unwrap(),
        "Bearer openai-secret"
    );
}

#[test]
fn shared_provider_catalog_supplies_runtime_base_urls() {
    assert_eq!(
        provider_default_base_url(&AiModelProviderKind::OpenAi),
        Some("https://api.openai.com/v1")
    );
    assert_eq!(
        provider_default_base_url(&AiModelProviderKind::Ollama),
        Some("http://127.0.0.1:11434/v1")
    );
    assert_eq!(
        provider_default_base_url(&AiModelProviderKind::OpenAiCompatible),
        None
    );
}

#[test]
fn ollama_localhost_requests_use_the_ipv4_loopback() {
    let mut ollama = provider(AiModelProviderKind::Ollama);
    ollama.base_url = Some("http://localhost:11434/v1/".into());
    assert_eq!(
        normalized_base_url(&request(ollama)).unwrap(),
        "http://127.0.0.1:11434/v1"
    );

    let mut default_ollama = provider(AiModelProviderKind::Ollama);
    default_ollama.base_url = None;
    assert_eq!(
        normalized_base_url(&request(default_ollama)).unwrap(),
        "http://127.0.0.1:11434/v1"
    );

    let mut remote_ollama = provider(AiModelProviderKind::Ollama);
    remote_ollama.base_url = Some("http://localhost.example/v1".into());
    assert_eq!(
        normalized_base_url(&request(remote_ollama)).unwrap(),
        "http://localhost.example/v1"
    );

    let compatible = provider(AiModelProviderKind::OpenAiCompatible);
    assert_eq!(
        normalized_base_url(&request(compatible)).unwrap(),
        "https://example.com/v1"
    );
}

#[test]
fn custom_provider_requires_base_url() {
    let mut provider = provider(AiModelProviderKind::OpenAiCompatible);
    provider.base_url = Some(" ".into());

    assert_eq!(
        normalized_base_url(&request(provider)).unwrap_err(),
        "Custom API providers need a base URL.",
    );
}

#[test]
fn env_api_key_uses_shell_lookup_when_process_env_is_missing() {
    let mut provider = provider(AiModelProviderKind::Anthropic);
    provider.api_key_storage = Some(AiModelApiKeyStorage::Env);
    provider.api_key_env_var = Some("ANTHROPIC_API_KEY".into());
    let request = request(provider);

    let api_key =
        api_key_from_env_with_lookup(&request, |_| Some("shell-secret".to_string())).unwrap();

    assert_eq!(api_key.as_deref(), Some("shell-secret"));
}

#[test]
fn extracts_provider_text_payloads_and_reports_empty_responses() {
    let openai = json!({
        "choices": [{ "message": { "content": "Hello from OpenAI" } }]
    });
    let anthropic = json!({
        "content": [
            { "text": "Hello " },
            { "text": "from Anthropic" }
        ]
    });

    assert_eq!(extract_openai_text(&openai).unwrap(), "Hello from OpenAI");
    assert_eq!(
        extract_anthropic_text(&anthropic).unwrap(),
        "Hello from Anthropic"
    );
    assert_eq!(
        extract_openai_text(&json!({ "choices": [] })).unwrap_err(),
        "AI provider response did not include assistant text.",
    );
    assert_eq!(
        extract_anthropic_text(&json!({ "content": [{ "type": "thinking" }] })).unwrap_err(),
        "Anthropic response did not include assistant text.",
    );
}

#[test]
fn saves_reads_and_validates_local_provider_secrets() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested/secrets.json");
    let secrets = AiProviderSecrets {
        provider_api_keys: BTreeMap::from([("demo".into(), "secret".into())]),
    };

    write_secrets_at(&path, &secrets).unwrap();

    assert_eq!(read_secrets_at(&path).unwrap(), secrets);
    assert_eq!(
        read_secrets_at(&dir.path().join("missing.json")).unwrap(),
        AiProviderSecrets::default()
    );
    assert_eq!(normalize_secret_provider_id(" Demo ").unwrap(), "demo");
    assert_eq!(
        normalize_secret_provider_id(" ").unwrap_err(),
        "Provider ID cannot be empty.",
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[test]
fn truncates_long_provider_errors_without_touching_short_errors() {
    let short = "provider unavailable";
    let long = "x".repeat(605);

    assert_eq!(truncate_error(short), short);
    assert_eq!(truncate_error(&long).len(), 603);
    assert!(truncate_error(&long).ends_with("..."));
}
