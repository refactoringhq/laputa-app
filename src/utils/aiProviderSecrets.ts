import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'
import type { AiModelProvider } from '../lib/aiTargets'

export async function saveAiModelProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  if (!isTauri()) return
  await invoke('save_ai_model_provider_api_key', { providerId, apiKey })
}

export async function deleteAiModelProviderApiKey(providerId: string): Promise<void> {
  if (!isTauri()) return
  await invoke('delete_ai_model_provider_api_key', { providerId })
}

export async function testAiModelProvider(
  provider: AiModelProvider,
  modelId: string,
  apiKeyOverride: string | null,
): Promise<string> {
  if (!isTauri()) return 'OK'
  return invoke<string>('test_ai_model_provider', {
    request: {
      provider,
      model_id: modelId,
      api_key_override: apiKeyOverride,
    },
  })
}
