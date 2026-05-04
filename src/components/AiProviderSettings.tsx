import { useState } from 'react'
import {
  DEFAULT_MODEL_CAPABILITIES,
  aiModelProviderCatalog,
  aiModelProviderCatalogEntry,
  configuredModelTargets,
  isLocalAiProvider,
  normalizeAiModelProviders,
  type AiModelApiKeyStorage,
  type AiModelProvider,
  type AiModelProviderKind,
} from '../lib/aiTargets'
import type { createTranslator } from '../lib/i18n'
import { deleteAiModelProviderApiKey, saveAiModelProviderApiKey, testAiModelProvider } from '../utils/aiProviderSecrets'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

type Translate = ReturnType<typeof createTranslator>
type ProviderMode = 'local' | 'api'
type TestState = 'idle' | 'testing' | 'success'

interface AiProviderSettingsProps {
  t: Translate
  mode: ProviderMode
  providers: AiModelProvider[]
  onChange: (providers: AiModelProvider[]) => void
}

interface ProviderDraft {
  kind: AiModelProviderKind
  name: string
  baseUrl: string
  modelId: string
  apiKeyStorage: AiModelApiKeyStorage
  apiKey: string
  apiKeyEnvVar: string
}

function providerKindsForMode(mode: ProviderMode): AiModelProviderKind[] {
  return aiModelProviderCatalog()
    .filter((entry) => entry.local === (mode === 'local'))
    .map((entry) => entry.kind)
}

function initialDraft(mode: ProviderMode): ProviderDraft {
  const [kind] = providerKindsForMode(mode)
  if (!kind) throw new Error(`No AI model providers are configured for ${mode} mode`)
  return draftFromProviderKind(kind)
}

function draftFromProviderKind(kind: AiModelProviderKind): ProviderDraft {
  const defaults = aiModelProviderCatalogEntry(kind)
  return {
    kind,
    name: defaults.name,
    baseUrl: defaults.base_url,
    modelId: '',
    apiKeyStorage: defaults.api_key_storage,
    apiKey: '',
    apiKeyEnvVar: defaults.api_key_env_var ?? '',
  }
}

function providerKindOptions(mode: ProviderMode, t: Translate): Array<{ value: AiModelProviderKind; label: string }> {
  return providerKindsForMode(mode).map((kind) => {
    const defaults = aiModelProviderCatalogEntry(kind)
    return { value: kind, label: t(defaults.label_key) }
  })
}

function providerPresetPatch(kind: AiModelProviderKind): Pick<ProviderDraft, 'kind' | 'name' | 'baseUrl' | 'apiKeyStorage' | 'apiKeyEnvVar'> {
  const defaults = draftFromProviderKind(kind)
  return {
    kind,
    name: defaults.name,
    baseUrl: defaults.baseUrl,
    apiKeyStorage: defaults.apiKeyStorage,
    apiKeyEnvVar: defaults.apiKeyEnvVar,
  }
}

function buildProvider(draft: ProviderDraft, providerId: string): AiModelProvider {
  return {
    id: providerId,
    name: draft.name,
    kind: draft.kind,
    base_url: draft.baseUrl || null,
    api_key_storage: draft.apiKeyStorage,
    api_key_env_var: draft.apiKeyStorage === 'env' ? draft.apiKeyEnvVar || null : null,
    headers: null,
    models: [{
      id: draft.modelId,
      display_name: null,
      context_window: null,
      max_output_tokens: null,
      capabilities: DEFAULT_MODEL_CAPABILITIES,
    }],
  }
}

function providerModeTitle(mode: ProviderMode, t: Translate): string {
  return mode === 'local' ? t('settings.aiProviders.localTitle') : t('settings.aiProviders.apiTitle')
}

function providerModeDescription(mode: ProviderMode, t: Translate): string {
  return mode === 'local' ? t('settings.aiProviders.localDescription') : t('settings.aiProviders.apiDescription')
}

function providerStorageLabel(provider: AiModelProvider, t: Translate): string {
  if (provider.api_key_storage === 'local_file') return t('settings.aiProviders.keyLocalSaved')
  if (provider.api_key_storage === 'env' && provider.api_key_env_var) {
    return t('settings.aiProviders.keyEnvSaved', { env: provider.api_key_env_var })
  }
  return t('settings.aiProviders.noKey')
}

function visibleProviders(providers: AiModelProvider[], mode: ProviderMode): AiModelProvider[] {
  return providers.filter((provider) => mode === 'local' ? isLocalAiProvider(provider) : !isLocalAiProvider(provider))
}

function editableInputClassName(): string {
  return 'border-border bg-background text-foreground placeholder:text-muted-foreground/65 shadow-xs'
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password'
}) {
  return (
    <label className="space-y-1.5 text-xs font-medium text-foreground">
      <span>{label}</span>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={editableInputClassName()}
      />
    </label>
  )
}

function ProviderKindSelect({
  mode,
  t,
  value,
  onChange,
}: {
  mode: ProviderMode
  t: Translate
  value: AiModelProviderKind
  onChange: (value: AiModelProviderKind) => void
}) {
  return (
    <label className="space-y-1.5 text-xs font-medium text-foreground">
      <span>{t('settings.aiProviders.kind')}</span>
      <Select value={value} onValueChange={(next) => onChange(next as AiModelProviderKind)}>
        <SelectTrigger className={`h-9 ${editableInputClassName()}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {providerKindOptions(mode, t).map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

function ApiKeyStorageFields({
  t,
  draft,
  updateDraft,
}: {
  t: Translate
  draft: ProviderDraft
  updateDraft: (patch: Partial<ProviderDraft>) => void
}) {
  return (
    <>
      <label className="space-y-1.5 text-xs font-medium text-foreground">
        <span>{t('settings.aiProviders.keyStorage')}</span>
        <Select value={draft.apiKeyStorage} onValueChange={(next) => updateDraft({ apiKeyStorage: next as AiModelApiKeyStorage })}>
          <SelectTrigger className={`h-9 ${editableInputClassName()}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local_file">{t('settings.aiProviders.keyStorage.local')}</SelectItem>
            <SelectItem value="env">{t('settings.aiProviders.keyStorage.env')}</SelectItem>
            <SelectItem value="none">{t('settings.aiProviders.keyStorage.none')}</SelectItem>
          </SelectContent>
        </Select>
      </label>
      {draft.apiKeyStorage === 'local_file' ? (
        <LabeledInput
          label={t('settings.aiProviders.key')}
          value={draft.apiKey}
          onChange={(apiKey) => updateDraft({ apiKey })}
          placeholder={t('settings.aiProviders.keyPlaceholder')}
          type="password"
        />
      ) : null}
      {draft.apiKeyStorage === 'env' ? (
        <LabeledInput
          label={t('settings.aiProviders.keyEnv')}
          value={draft.apiKeyEnvVar}
          onChange={(apiKeyEnvVar) => updateDraft({ apiKeyEnvVar })}
          placeholder={aiModelProviderCatalogEntry(draft.kind).api_key_env_var ?? ''}
        />
      ) : null}
    </>
  )
}

function ProviderList({
  t,
  mode,
  providers,
  onRemove,
}: {
  t: Translate
  mode: ProviderMode
  providers: AiModelProvider[]
  onRemove: (providerId: string) => void
}) {
  const visible = visibleProviders(providers, mode)
  if (visible.length === 0) {
    return <div className="rounded-md border border-dashed border-border bg-background px-3 py-2 text-xs text-muted-foreground">{t('settings.aiProviders.empty')}</div>
  }

  return (
    <div className="space-y-2">
      {configuredModelTargets(visible).map((target) => (
        <div key={target.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{target.label}</div>
            <div className="truncate text-xs text-muted-foreground">
              {target.provider.base_url || t('settings.aiProviders.defaultEndpoint')} · {providerStorageLabel(target.provider, t)}
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(target.provider.id)}>
            {t('common.remove')}
          </Button>
        </div>
      ))}
    </div>
  )
}

export function AiProviderSettings({ t, mode, providers, onChange }: AiProviderSettingsProps) {
  const [draft, setDraft] = useState<ProviderDraft>(() => initialDraft(mode))
  const [error, setError] = useState<string | null>(null)
  const [testState, setTestState] = useState<TestState>('idle')
  const updateDraft = (patch: Partial<ProviderDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const resetTest = () => {
    setTestState('idle')
    setError(null)
  }
  const updateForm = (patch: Partial<ProviderDraft>) => {
    resetTest()
    updateDraft(patch)
  }
  const updateKind = (kind: AiModelProviderKind) => updateForm(providerPresetPatch(kind))
  const canSave = draft.name.trim() && draft.modelId.trim() && (draft.apiKeyStorage !== 'local_file' || draft.apiKey.trim())
  const apiKeyOverride = draft.apiKeyStorage === 'local_file' ? draft.apiKey : null

  const addProvider = async () => {
    const providerId = `${draft.kind}-${Date.now().toString(36)}`
    setError(null)
    try {
      if (draft.apiKeyStorage === 'local_file') {
        await saveAiModelProviderApiKey(providerId, draft.apiKey)
      }
      onChange(normalizeAiModelProviders([...providers, buildProvider(draft, providerId)]))
      setDraft((current) => ({ ...draftFromProviderKind(current.kind), name: current.name, baseUrl: current.baseUrl }))
      setTestState('idle')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  const testProvider = async () => {
    setError(null)
    setTestState('testing')
    try {
      await testAiModelProvider(buildProvider(draft, 'draft-provider-test'), draft.modelId, apiKeyOverride)
      setTestState('success')
    } catch (error) {
      setTestState('idle')
      setError(error instanceof Error ? error.message : String(error))
    }
  }
  const removeProvider = (providerId: string) => {
    void deleteAiModelProviderApiKey(providerId)
    onChange(providers.filter((provider) => provider.id !== providerId))
  }

  return (
    <div className="rounded-md border border-border bg-card p-3" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div className="text-sm font-medium text-foreground">{providerModeTitle(mode, t)}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{providerModeDescription(mode, t)}</div>
      </div>
      <ProviderList t={t} mode={mode} providers={providers} onRemove={removeProvider} />
      <div className="grid grid-cols-2 gap-3">
        <ProviderKindSelect mode={mode} t={t} value={draft.kind} onChange={updateKind} />
        <LabeledInput label={t('settings.aiProviders.name')} value={draft.name} onChange={(name) => updateForm({ name })} />
        <LabeledInput label={t('settings.aiProviders.baseUrl')} value={draft.baseUrl} onChange={(baseUrl) => updateForm({ baseUrl })} />
        <LabeledInput label={t('settings.aiProviders.model')} value={draft.modelId} onChange={(modelId) => updateForm({ modelId })} placeholder={aiModelProviderCatalogEntry(draft.kind).default_model_id} />
        {mode === 'api' ? <ApiKeyStorageFields t={t} draft={draft} updateDraft={updateForm} /> : null}
      </div>
      <div className="text-xs leading-5 text-muted-foreground">
        {mode === 'api' ? t('settings.aiProviders.keySafetyLocal') : t('settings.aiProviders.localSafety')}
      </div>
      {testState === 'success' ? <div className="text-xs text-emerald-700">{t('settings.aiProviders.testSuccess')}</div> : null}
      {error ? <div className="text-xs text-destructive">{error}</div> : null}
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={() => void addProvider()} disabled={!canSave}>
          {mode === 'local' ? t('settings.aiProviders.addLocal') : t('settings.aiProviders.addApi')}
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 text-muted-foreground hover:text-foreground"
          onClick={() => void testProvider()}
          disabled={!canSave || testState === 'testing'}
        >
          {testState === 'testing' ? t('settings.aiProviders.testing') : t('settings.aiProviders.test')}
        </Button>
      </div>
    </div>
  )
}
