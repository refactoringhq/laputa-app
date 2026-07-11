# Configure AI Models

Source: guides/configure-ai-models.md
URL: /guides/configure-ai-models

# Configure AI Models

Use model providers when you want chat over note context without giving an agent vault-write tools.

## Local Models

Local model targets are for tools such as Ollama and LM Studio. They need a base URL and model ID, and they can run with or without an API key depending on how your local server is secured.

## API Models

API model targets are for hosted providers such as OpenAI, Anthropic, Gemini, OpenRouter, or another OpenAI-compatible endpoint.

Tolaria does not store provider API keys in vault settings. Choose one of the supported key paths:

- Save the key locally on this device.
- Read the key from an environment variable.
- Use no key for providers that do not require one.

## Test The Connection

After adding a provider, use the test action in Settings. A successful test means Tolaria reached the endpoint and the model replied.

## Select The Target

Once configured, choose the model from the AI target selector or set it as the default AI target in Settings.
