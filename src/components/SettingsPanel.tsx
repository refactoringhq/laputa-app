import {
  AI_AGENT_DEFINITIONS,
  createMissingAiAgentsStatus,
  getAiAgentDefinition,
  resolveDefaultAiAgent,
  type AiAgentId,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { Moon, Sun, X } from '@phosphor-icons/react'
import { Copy } from 'lucide-react'
import type { Settings } from '../types'
import {
  APP_LOCALES,
  SYSTEM_UI_LANGUAGE,
  createTranslator,
  localeDisplayName,
  resolveEffectiveLocale,
  serializeUiLanguagePreference,
  type AppLocale,
  type UiLanguagePreference,
} from '../lib/i18n'
import {
  applyThemeModeToDocument,
  DEFAULT_THEME_MODE,
  readStoredThemeMode,
  type ThemeMode,
  writeStoredThemeMode,
} from '../lib/themeMode'
import { normalizeReleaseChannel, serializeReleaseChannel, type ReleaseChannel } from '../lib/releaseChannel'
import { shouldHideGitignoredFiles } from '../lib/gitignoredVisibility'
import { trackEvent } from '../lib/telemetry'
import { Button } from './ui/button'
import { Checkbox, type CheckedState } from './ui/checkbox'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Switch } from './ui/switch'

interface SettingsPanelProps {
  open: boolean
  settings: Settings
  aiAgentsStatus?: AiAgentsStatus
  locale?: AppLocale
  systemLocale?: AppLocale
  onSave: (settings: Settings) => void
  onCopyMcpConfig?: () => void
  isGitVault?: boolean
  explicitOrganizationEnabled?: boolean
  onSaveExplicitOrganization?: (enabled: boolean) => void
  onClose: () => void
}

interface SettingsDraft {
  pullInterval: number
  autoGitEnabled: boolean
  autoGitIdleThresholdSeconds: number
  autoGitInactiveThresholdSeconds: number
  autoAdvanceInboxAfterOrganize: boolean
  defaultAiAgent: AiAgentId
  releaseChannel: ReleaseChannel
  themeMode: ThemeMode
  uiLanguage: UiLanguagePreference
  initialH1AutoRename: boolean
  hideGitignoredFiles: boolean
  crashReporting: boolean
  analytics: boolean
  explicitOrganization: boolean
}

interface SettingsBodyProps {
  t: Translate
  pullInterval: number
  setPullInterval: (value: number) => void
  isGitVault: boolean
  autoGitEnabled: boolean
  setAutoGitEnabled: (value: boolean) => void
  autoGitIdleThresholdSeconds: number
  setAutoGitIdleThresholdSeconds: (value: number) => void
  autoGitInactiveThresholdSeconds: number
  setAutoGitInactiveThresholdSeconds: (value: number) => void
  autoAdvanceInboxAfterOrganize: boolean
  setAutoAdvanceInboxAfterOrganize: (value: boolean) => void
  aiAgentsStatus: AiAgentsStatus
  defaultAiAgent: AiAgentId
  setDefaultAiAgent: (value: AiAgentId) => void
  onCopyMcpConfig?: () => void
  releaseChannel: ReleaseChannel
  setReleaseChannel: (value: ReleaseChannel) => void
  themeMode: ThemeMode
  setThemeMode: (value: ThemeMode) => void
  uiLanguage: UiLanguagePreference
  setUiLanguage: (value: UiLanguagePreference) => void
  locale: AppLocale
  systemLocale: AppLocale
  initialH1AutoRename: boolean
  setInitialH1AutoRename: (value: boolean) => void
  hideGitignoredFiles: boolean
  setHideGitignoredFiles: (value: boolean) => void
  explicitOrganization: boolean
  setExplicitOrganization: (value: boolean) => void
  crashReporting: boolean
  setCrashReporting: (value: boolean) => void
  analytics: boolean
  setAnalytics: (value: boolean) => void
}

const PULL_INTERVAL_OPTIONS = [1, 2, 5, 10, 15, 30] as const
const DEFAULT_AUTOGIT_IDLE_THRESHOLD_SECONDS = 90
const DEFAULT_AUTOGIT_INACTIVE_THRESHOLD_SECONDS = 30
type Translate = ReturnType<typeof createTranslator>

function isSaveShortcut(event: ReactKeyboardEvent): boolean {
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey)
}

function createSettingsDraft(
  settings: Settings,
  explicitOrganizationEnabled: boolean,
): SettingsDraft {
  return {
    pullInterval: settings.auto_pull_interval_minutes ?? 5,
    autoGitEnabled: settings.autogit_enabled ?? false,
    autoGitIdleThresholdSeconds: sanitizePositiveInteger(
      settings.autogit_idle_threshold_seconds,
      DEFAULT_AUTOGIT_IDLE_THRESHOLD_SECONDS,
    ),
    autoGitInactiveThresholdSeconds: sanitizePositiveInteger(
      settings.autogit_inactive_threshold_seconds,
      DEFAULT_AUTOGIT_INACTIVE_THRESHOLD_SECONDS,
    ),
    autoAdvanceInboxAfterOrganize: settings.auto_advance_inbox_after_organize ?? false,
    defaultAiAgent: resolveDefaultAiAgent(settings.default_ai_agent),
    releaseChannel: normalizeReleaseChannel(settings.release_channel),
    themeMode: resolveSettingsDraftThemeMode(settings.theme_mode),
    uiLanguage: settings.ui_language ?? SYSTEM_UI_LANGUAGE,
    initialH1AutoRename: settings.initial_h1_auto_rename_enabled ?? true,
    hideGitignoredFiles: shouldHideGitignoredFiles(settings),
    crashReporting: settings.crash_reporting_enabled ?? false,
    analytics: settings.analytics_enabled ?? false,
    explicitOrganization: explicitOrganizationEnabled,
  }
}

function resolveSettingsDraftThemeMode(themeMode: Settings['theme_mode']): ThemeMode {
  if (themeMode) return themeMode
  if (typeof window === 'undefined') return DEFAULT_THEME_MODE
  return readStoredThemeMode(window.localStorage) ?? DEFAULT_THEME_MODE
}

function resolveTelemetryConsent(settings: Settings, draft: SettingsDraft): boolean | null {
  if (draft.crashReporting || draft.analytics) return true
  return settings.telemetry_consent === null ? null : false
}

function resolveAnonymousId(settings: Settings, draft: SettingsDraft): string | null {
  if (draft.crashReporting || draft.analytics) {
    return settings.anonymous_id ?? crypto.randomUUID()
  }

  return settings.anonymous_id
}

function buildSettingsFromDraft(settings: Settings, draft: SettingsDraft): Settings {
  return {
    auto_pull_interval_minutes: draft.pullInterval,
    autogit_enabled: draft.autoGitEnabled,
    autogit_idle_threshold_seconds: draft.autoGitIdleThresholdSeconds,
    autogit_inactive_threshold_seconds: draft.autoGitInactiveThresholdSeconds,
    auto_advance_inbox_after_organize: draft.autoAdvanceInboxAfterOrganize,
    telemetry_consent: resolveTelemetryConsent(settings, draft),
    crash_reporting_enabled: draft.crashReporting,
    analytics_enabled: draft.analytics,
    anonymous_id: resolveAnonymousId(settings, draft),
    release_channel: serializeReleaseChannel(draft.releaseChannel),
    theme_mode: draft.themeMode,
    ui_language: serializeUiLanguagePreference(draft.uiLanguage),
    initial_h1_auto_rename_enabled: draft.initialH1AutoRename,
    default_ai_agent: draft.defaultAiAgent,
    hide_gitignored_files: draft.hideGitignoredFiles,
  }
}

function trackTelemetryConsentChange(previousAnalytics: boolean, nextAnalytics: boolean): void {
  if (!previousAnalytics && nextAnalytics) trackEvent('telemetry_opted_in')
  if (previousAnalytics && !nextAnalytics) trackEvent('telemetry_opted_out')
}

function isChecked(checked: CheckedState): boolean {
  return checked === true
}

function sanitizePositiveInteger(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 1) return fallback
  return Math.round(value)
}

function applyThemeModeSelection(value: ThemeMode): void {
  if (typeof document !== 'undefined') applyThemeModeToDocument(document, value)
  if (typeof window !== 'undefined') writeStoredThemeMode(window.localStorage, value)
}

export function SettingsPanel({
  open,
  settings,
  aiAgentsStatus = createMissingAiAgentsStatus(),
  locale = 'en',
  systemLocale = locale,
  onSave,
  onCopyMcpConfig,
  isGitVault = true,
  explicitOrganizationEnabled = true,
  onSaveExplicitOrganization,
  onClose,
}: SettingsPanelProps) {
  if (!open) return null

  return (
    <SettingsPanelInner
      settings={settings}
      aiAgentsStatus={aiAgentsStatus}
      locale={locale}
      systemLocale={systemLocale}
      onSave={onSave}
      onCopyMcpConfig={onCopyMcpConfig}
      isGitVault={isGitVault}
      explicitOrganizationEnabled={explicitOrganizationEnabled}
      onSaveExplicitOrganization={onSaveExplicitOrganization}
      onClose={onClose}
    />
  )
}

type SettingsPanelInnerProps = Omit<SettingsPanelProps, 'open' | 'explicitOrganizationEnabled' | 'aiAgentsStatus' | 'isGitVault'> & {
  aiAgentsStatus: AiAgentsStatus
  locale: AppLocale
  systemLocale: AppLocale
  isGitVault: boolean
  explicitOrganizationEnabled: boolean
}

function SettingsPanelInner({
  settings,
  aiAgentsStatus,
  systemLocale,
  onSave,
  onCopyMcpConfig,
  isGitVault,
  explicitOrganizationEnabled,
  onSaveExplicitOrganization,
  onClose,
}: SettingsPanelInnerProps) {
  const [draft, setDraft] = useState(() => createSettingsDraft(settings, explicitOrganizationEnabled))
  const panelRef = useRef<HTMLDivElement>(null)
  const draftLocale = resolveEffectiveLocale(draft.uiLanguage, [systemLocale])
  const t = createTranslator(draftLocale)

  useEffect(() => {
    setDraft(createSettingsDraft(settings, explicitOrganizationEnabled))
  }, [explicitOrganizationEnabled, settings])

  useEffect(() => {
    const timer = setTimeout(() => {
      const focusTarget = panelRef.current?.querySelector<HTMLElement>('[data-settings-autofocus="true"]')
      focusTarget?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  const updateDraft = useCallback(
    <Key extends keyof SettingsDraft>(key: Key, value: SettingsDraft[Key]) => {
      setDraft((current) => ({ ...current, [key]: value }))
    },
    [],
  )

  const handleGitignoredVisibilityChange = useCallback((value: boolean) => {
    updateDraft('hideGitignoredFiles', value)
    onSave({ ...settings, hide_gitignored_files: value })
  }, [onSave, settings, updateDraft])

  const handleThemeModeChange = useCallback((value: ThemeMode) => {
    updateDraft('themeMode', value)
    applyThemeModeSelection(value)
    onSave({ ...settings, theme_mode: value })
  }, [onSave, settings, updateDraft])

  const handleSave = useCallback(() => {
    trackTelemetryConsentChange(settings.analytics_enabled === true, draft.analytics)
    onSave(buildSettingsFromDraft(settings, draft))
    onSaveExplicitOrganization?.(draft.explicitOrganization)
    onClose()
  }, [draft, onClose, onSave, onSaveExplicitOrganization, settings])

  const handleBackdropClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }, [onClose])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }

      if (isSaveShortcut(event)) {
        event.preventDefault()
        handleSave()
      }
    },
    [handleSave, onClose],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--shadow-overlay)' }}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="settings-panel"
    >
      <div
        ref={panelRef}
        className="rounded-lg border border-border bg-background shadow-[0_18px_55px_var(--shadow-dialog)]"
        style={{ width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <SettingsHeader onClose={onClose} t={t} />
        <SettingsBody
          t={t}
          locale={draftLocale}
          systemLocale={systemLocale}
          pullInterval={draft.pullInterval}
          setPullInterval={(value) => updateDraft('pullInterval', value)}
          isGitVault={isGitVault}
          autoGitEnabled={draft.autoGitEnabled}
          setAutoGitEnabled={(value) => updateDraft('autoGitEnabled', value)}
          autoGitIdleThresholdSeconds={draft.autoGitIdleThresholdSeconds}
          setAutoGitIdleThresholdSeconds={(value) => updateDraft('autoGitIdleThresholdSeconds', value)}
          autoGitInactiveThresholdSeconds={draft.autoGitInactiveThresholdSeconds}
          setAutoGitInactiveThresholdSeconds={(value) => updateDraft('autoGitInactiveThresholdSeconds', value)}
          autoAdvanceInboxAfterOrganize={draft.autoAdvanceInboxAfterOrganize}
          setAutoAdvanceInboxAfterOrganize={(value) => updateDraft('autoAdvanceInboxAfterOrganize', value)}
          aiAgentsStatus={aiAgentsStatus}
          defaultAiAgent={draft.defaultAiAgent}
          setDefaultAiAgent={(value) => updateDraft('defaultAiAgent', value)}
          onCopyMcpConfig={onCopyMcpConfig}
          releaseChannel={draft.releaseChannel}
          setReleaseChannel={(value) => updateDraft('releaseChannel', value)}
          themeMode={draft.themeMode}
          setThemeMode={handleThemeModeChange}
          uiLanguage={draft.uiLanguage}
          setUiLanguage={(value) => updateDraft('uiLanguage', value)}
          initialH1AutoRename={draft.initialH1AutoRename}
          setInitialH1AutoRename={(value) => updateDraft('initialH1AutoRename', value)}
          hideGitignoredFiles={draft.hideGitignoredFiles}
          setHideGitignoredFiles={handleGitignoredVisibilityChange}
          explicitOrganization={draft.explicitOrganization}
          setExplicitOrganization={(value) => updateDraft('explicitOrganization', value)}
          crashReporting={draft.crashReporting}
          setCrashReporting={(value) => updateDraft('crashReporting', value)}
          analytics={draft.analytics}
          setAnalytics={(value) => updateDraft('analytics', value)}
        />
        <SettingsFooter onClose={onClose} onSave={handleSave} t={t} />
      </div>
    </div>
  )
}

function SettingsHeader({ onClose, t }: { onClose: () => void; t: Translate }) {
  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{ height: 56, padding: '0 24px', borderBottom: '1px solid var(--border)' }}
    >
      <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)' }}>{t('settings.title')}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        title={t('settings.close')}
        aria-label={t('settings.close')}
      >
        <X size={16} />
      </Button>
    </div>
  )
}

function SettingsBody({
  t,
  locale,
  systemLocale,
  pullInterval,
  setPullInterval,
  isGitVault,
  autoGitEnabled,
  setAutoGitEnabled,
  autoGitIdleThresholdSeconds,
  setAutoGitIdleThresholdSeconds,
  autoGitInactiveThresholdSeconds,
  setAutoGitInactiveThresholdSeconds,
  autoAdvanceInboxAfterOrganize,
  setAutoAdvanceInboxAfterOrganize,
  aiAgentsStatus,
  defaultAiAgent,
  setDefaultAiAgent,
  onCopyMcpConfig,
  releaseChannel,
  setReleaseChannel,
  themeMode,
  setThemeMode,
  uiLanguage,
  setUiLanguage,
  initialH1AutoRename,
  setInitialH1AutoRename,
  hideGitignoredFiles,
  setHideGitignoredFiles,
  explicitOrganization,
  setExplicitOrganization,
  crashReporting,
  setCrashReporting,
  analytics,
  setAnalytics,
}: SettingsBodyProps) {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 0, overflow: 'auto' }}>
      <SettingsSection showDivider={false}>
        <SyncAndUpdatesSection
          t={t}
          pullInterval={pullInterval}
          setPullInterval={setPullInterval}
          releaseChannel={releaseChannel}
          setReleaseChannel={setReleaseChannel}
        />
      </SettingsSection>

      <SettingsSection>
        <AutoGitSettingsSection
          t={t}
          isGitVault={isGitVault}
          autoGitEnabled={autoGitEnabled}
          setAutoGitEnabled={setAutoGitEnabled}
          autoGitIdleThresholdSeconds={autoGitIdleThresholdSeconds}
          setAutoGitIdleThresholdSeconds={setAutoGitIdleThresholdSeconds}
          autoGitInactiveThresholdSeconds={autoGitInactiveThresholdSeconds}
          setAutoGitInactiveThresholdSeconds={setAutoGitInactiveThresholdSeconds}
        />
      </SettingsSection>

      <SettingsSection>
        <AppearanceSettingsSection
          t={t}
          themeMode={themeMode}
          setThemeMode={setThemeMode}
        />
      </SettingsSection>

      <SettingsSection>
        <LanguageSettingsSection
          t={t}
          locale={locale}
          systemLocale={systemLocale}
          uiLanguage={uiLanguage}
          setUiLanguage={setUiLanguage}
        />
      </SettingsSection>

      <SettingsSection>
        <TitleSettingsSection
          t={t}
          initialH1AutoRename={initialH1AutoRename}
          setInitialH1AutoRename={setInitialH1AutoRename}
        />
      </SettingsSection>

      <SettingsSection>
        <VaultContentSettingsSection
          t={t}
          hideGitignoredFiles={hideGitignoredFiles}
          setHideGitignoredFiles={setHideGitignoredFiles}
        />
      </SettingsSection>

      <SettingsSection>
        <AiAgentSettingsSection
          t={t}
          aiAgentsStatus={aiAgentsStatus}
          defaultAiAgent={defaultAiAgent}
          setDefaultAiAgent={setDefaultAiAgent}
          onCopyMcpConfig={onCopyMcpConfig}
        />
      </SettingsSection>

      <SettingsSection>
        <OrganizationWorkflowSection
          t={t}
          checked={explicitOrganization}
          onChange={setExplicitOrganization}
          autoAdvanceInboxAfterOrganize={autoAdvanceInboxAfterOrganize}
          onChangeAutoAdvanceInboxAfterOrganize={setAutoAdvanceInboxAfterOrganize}
        />
      </SettingsSection>

      <SettingsSection>
        <PrivacySettingsSection
          t={t}
          crashReporting={crashReporting}
          setCrashReporting={setCrashReporting}
          analytics={analytics}
          setAnalytics={setAnalytics}
        />
      </SettingsSection>
    </div>
  )
}

function SyncAndUpdatesSection({
  t,
  pullInterval,
  setPullInterval,
  releaseChannel,
  setReleaseChannel,
}: Pick<SettingsBodyProps, 't' | 'pullInterval' | 'setPullInterval' | 'releaseChannel' | 'setReleaseChannel'>) {
  return (
    <>
      <SectionHeading
        title={t('settings.sync.title')}
        description={t('settings.sync.description')}
      />

      <LabeledSelect
        label={t('settings.pullInterval')}
        value={`${pullInterval}`}
        onValueChange={(value) => setPullInterval(Number(value))}
        options={PULL_INTERVAL_OPTIONS.map((value) => ({
          value: `${value}`,
          label: `${value}`,
        }))}
        testId="settings-pull-interval"
        autoFocus={true}
      />

      <LabeledSelect
        label={t('settings.releaseChannel')}
        value={releaseChannel}
        onValueChange={(value) => setReleaseChannel(value as ReleaseChannel)}
        options={[
          { value: 'stable', label: t('settings.releaseStable') },
          { value: 'alpha', label: t('settings.releaseAlpha') },
        ]}
        testId="settings-release-channel"
      />
    </>
  )
}

function AppearanceSettingsSection({
  t,
  themeMode,
  setThemeMode,
}: Pick<SettingsBodyProps, 't' | 'themeMode' | 'setThemeMode'>) {
  return (
    <>
      <SectionHeading
        title={t('settings.appearance.title')}
        description={t('settings.appearance.description')}
      />

      <ThemeModeControl value={themeMode} onChange={setThemeMode} t={t} />
    </>
  )
}

function ThemeModeControl({
  value,
  onChange,
  t,
}: {
  value: ThemeMode
  onChange: (value: ThemeMode) => void
  t: Translate
}) {
  return (
    <div
      className="inline-flex w-full rounded-md border border-border bg-muted p-1"
      role="radiogroup"
      aria-label={t('settings.theme.label')}
      data-testid="settings-theme-mode"
    >
      <ThemeModeButton label={t('settings.theme.light')} selected={value === 'light'} value="light" onSelect={onChange}>
        <Sun size={14} />
      </ThemeModeButton>
      <ThemeModeButton label={t('settings.theme.dark')} selected={value === 'dark'} value="dark" onSelect={onChange}>
        <Moon size={14} />
      </ThemeModeButton>
    </div>
  )
}

function ThemeModeButton({
  children,
  label,
  selected,
  value,
  onSelect,
}: {
  children: ReactNode
  label: string
  selected: boolean
  value: ThemeMode
  onSelect: (value: ThemeMode) => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      data-testid={`settings-theme-${value}`}
      className={
        selected
          ? 'h-7 flex-1 border border-border bg-background text-foreground shadow-xs hover:bg-background'
          : 'h-7 flex-1 text-muted-foreground hover:text-foreground'
      }
      onClick={() => onSelect(value)}
    >
      {children}
      {label}
    </Button>
  )
}

function autoGitSectionDescription(isGitVault: boolean, t: Translate): string {
  return isGitVault
    ? t('settings.autogit.description.enabled')
    : t('settings.autogit.description.disabled')
}

function AutoGitSettingsSection({
  t,
  isGitVault,
  autoGitEnabled,
  setAutoGitEnabled,
  autoGitIdleThresholdSeconds,
  setAutoGitIdleThresholdSeconds,
  autoGitInactiveThresholdSeconds,
  setAutoGitInactiveThresholdSeconds,
}: Pick<
  SettingsBodyProps,
  | 't'
  | 'isGitVault'
  | 'autoGitEnabled'
  | 'setAutoGitEnabled'
  | 'autoGitIdleThresholdSeconds'
  | 'setAutoGitIdleThresholdSeconds'
  | 'autoGitInactiveThresholdSeconds'
  | 'setAutoGitInactiveThresholdSeconds'
>) {
  return (
    <>
      <SectionHeading
        title={t('settings.autogit.title')}
        description={autoGitSectionDescription(isGitVault, t)}
      />

      <SettingsSwitchRow
        label={t('settings.autogit.enable')}
        description={t('settings.autogit.enableDescription')}
        checked={autoGitEnabled}
        onChange={setAutoGitEnabled}
        disabled={!isGitVault}
        testId="settings-autogit-enabled"
      />

      <LabeledNumberInput
        label={t('settings.autogit.idleThreshold')}
        value={autoGitIdleThresholdSeconds}
        onValueChange={setAutoGitIdleThresholdSeconds}
        testId="settings-autogit-idle-threshold"
        disabled={!isGitVault}
      />

      <LabeledNumberInput
        label={t('settings.autogit.inactiveThreshold')}
        value={autoGitInactiveThresholdSeconds}
        onValueChange={setAutoGitInactiveThresholdSeconds}
        testId="settings-autogit-inactive-threshold"
        disabled={!isGitVault}
      />
    </>
  )
}

function buildLanguageOptions(t: Translate, locale: AppLocale, systemLocale: AppLocale) {
  return [
    {
      value: SYSTEM_UI_LANGUAGE,
      label: t('settings.language.system', {
        language: localeDisplayName(systemLocale, locale),
      }),
    },
    ...APP_LOCALES.map((appLocale) => ({
      value: appLocale,
      label: localeDisplayName(appLocale, locale),
    })),
  ]
}

function LanguageSettingsSection({
  t,
  locale,
  systemLocale,
  uiLanguage,
  setUiLanguage,
}: Pick<SettingsBodyProps, 't' | 'locale' | 'systemLocale' | 'uiLanguage' | 'setUiLanguage'>) {
  return (
    <>
      <SectionHeading
        title={t('settings.language.title')}
        description={t('settings.language.description')}
      />

      <LabeledSelect
        label={t('settings.language.label')}
        value={uiLanguage}
        onValueChange={(value) => setUiLanguage(value as UiLanguagePreference)}
        options={buildLanguageOptions(t, locale, systemLocale)}
        testId="settings-ui-language"
      />

      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
        {t('settings.language.summary')}
      </div>
    </>
  )
}

function TitleSettingsSection({
  t,
  initialH1AutoRename,
  setInitialH1AutoRename,
}: Pick<SettingsBodyProps, 't' | 'initialH1AutoRename' | 'setInitialH1AutoRename'>) {
  return (
    <>
      <SectionHeading
        title={t('settings.titles.title')}
        description={t('settings.titles.description')}
      />

      <SettingsSwitchRow
        label={t('settings.titles.autoRename')}
        description={t('settings.titles.autoRenameDescription')}
        checked={initialH1AutoRename}
        onChange={setInitialH1AutoRename}
        testId="settings-initial-h1-auto-rename"
      />
    </>
  )
}

function VaultContentSettingsSection({
  t,
  hideGitignoredFiles,
  setHideGitignoredFiles,
}: Pick<SettingsBodyProps, 't' | 'hideGitignoredFiles' | 'setHideGitignoredFiles'>) {
  return (
    <>
      <SectionHeading
        title={t('settings.vaultContent.title')}
        description={t('settings.vaultContent.description')}
      />

      <SettingsSwitchRow
        label={t('settings.vaultContent.hideGitignored')}
        description={t('settings.vaultContent.hideGitignoredDescription')}
        checked={hideGitignoredFiles}
        onChange={setHideGitignoredFiles}
        testId="settings-hide-gitignored-files"
      />
    </>
  )
}

function buildDefaultAiAgentOptions(aiAgentsStatus: AiAgentsStatus, t: Translate): Array<{ value: string; label: string }> {
  return AI_AGENT_DEFINITIONS.map((definition) => {
    const status = aiAgentsStatus[definition.id]
    const suffix = status.status === 'installed'
      ? ` (${t('settings.aiAgents.installed')}${status.version ? ` ${status.version}` : ''})`
      : ` (${t('settings.aiAgents.missing')})`
    return {
      value: definition.id,
      label: `${definition.label}${suffix}`,
    }
  })
}

function AiAgentSettingsSection({
  t,
  aiAgentsStatus,
  defaultAiAgent,
  setDefaultAiAgent,
  onCopyMcpConfig,
}: Pick<SettingsBodyProps, 't' | 'aiAgentsStatus' | 'defaultAiAgent' | 'setDefaultAiAgent' | 'onCopyMcpConfig'>) {
  return (
    <>
      <SectionHeading
        title={t('settings.aiAgents.title')}
        description={t('settings.aiAgents.description')}
      />

      <LabeledSelect
        label={t('settings.aiAgents.default')}
        value={defaultAiAgent}
        onValueChange={(value) => setDefaultAiAgent(value as AiAgentId)}
        options={buildDefaultAiAgentOptions(aiAgentsStatus, t)}
        testId="settings-default-ai-agent"
      />

      <div style={{ fontSize: 11, color: 'var(--muted-foreground)', lineHeight: 1.5 }}>
        {renderDefaultAiAgentSummary(defaultAiAgent, aiAgentsStatus, t)}
      </div>

      {onCopyMcpConfig ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCopyMcpConfig}
          className="w-fit gap-2"
          aria-label={t('ai.panel.copyMcpConfig')}
          data-testid="settings-copy-mcp-config"
        >
          <Copy size={15} />
          {t('ai.panel.copyMcpConfig')}
        </Button>
      ) : null}
    </>
  )
}

function PrivacySettingsSection({
  t,
  crashReporting,
  setCrashReporting,
  analytics,
  setAnalytics,
}: Pick<SettingsBodyProps, 't' | 'crashReporting' | 'setCrashReporting' | 'analytics' | 'setAnalytics'>) {
  return (
    <>
      <SectionHeading
        title={t('settings.privacy.title')}
        description={t('settings.privacy.description')}
      />

      <TelemetryToggle
        label={t('settings.privacy.crashReporting')}
        description={t('settings.privacy.crashReportingDescription')}
        checked={crashReporting}
        onChange={setCrashReporting}
        testId="settings-crash-reporting"
      />
      <TelemetryToggle
        label={t('settings.privacy.analytics')}
        description={t('settings.privacy.analyticsDescription')}
        checked={analytics}
        onChange={setAnalytics}
        testId="settings-analytics"
      />
    </>
  )
}

function SettingsSection({
  children,
  showDivider = true,
}: {
  children: ReactNode
  showDivider?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 0' }}>
      {showDivider ? <Divider /> : null}
      {children}
    </div>
  )
}

function SectionHeading({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--muted-foreground)',
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted-foreground)', lineHeight: 1.55, maxWidth: 420 }}>
        {description}
      </div>
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: 'color-mix(in srgb, var(--border) 82%, transparent)' }} />
}

function renderDefaultAiAgentSummary(defaultAiAgent: AiAgentId, aiAgentsStatus: AiAgentsStatus, t: Translate): string {
  const definition = getAiAgentDefinition(defaultAiAgent)
  const status = aiAgentsStatus[defaultAiAgent]
  if (status.status === 'installed') {
    return t('settings.aiAgents.ready', {
      agent: definition.label,
      version: status.version ? ` ${status.version}` : '',
    })
  }
  return t('settings.aiAgents.notInstalled', { agent: definition.label })
}

function LabeledSelect({
  label,
  value,
  onValueChange,
  options,
  testId,
  autoFocus = false,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  testId: string
  autoFocus?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)' }}>{label}</label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger
          className="w-full bg-transparent"
          data-testid={testId}
          data-value={value}
          data-settings-autofocus={autoFocus ? 'true' : undefined}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" data-anchor-strategy="popper">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function LabeledNumberInput({
  label,
  value,
  onValueChange,
  testId,
  disabled = false,
}: {
  label: string
  value: number
  onValueChange: (value: number) => void
  testId: string
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)' }} htmlFor={testId}>{label}</label>
      <Input
        id={testId}
        type="number"
        min={1}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(sanitizePositiveInteger(Number(event.target.value), value))}
        data-testid={testId}
        className="w-full bg-transparent"
      />
    </div>
  )
}

function OrganizationWorkflowSection({
  t,
  checked,
  onChange,
  autoAdvanceInboxAfterOrganize,
  onChangeAutoAdvanceInboxAfterOrganize,
}: {
  t: Translate
  checked: boolean
  onChange: (value: boolean) => void
  autoAdvanceInboxAfterOrganize: boolean
  onChangeAutoAdvanceInboxAfterOrganize: (value: boolean) => void
}) {
  return (
    <>
      <SectionHeading
        title={t('settings.workflow.title')}
        description={t('settings.workflow.description')}
      />

      <SettingsSwitchRow
        label={t('settings.workflow.explicit')}
        description={t('settings.workflow.explicitDescription')}
        checked={checked}
        onChange={onChange}
        testId="settings-explicit-organization"
      />

      <SettingsSwitchRow
        label={t('settings.workflow.autoAdvance')}
        description={t('settings.workflow.autoAdvanceDescription')}
        checked={autoAdvanceInboxAfterOrganize}
        onChange={onChangeAutoAdvanceInboxAfterOrganize}
        testId="settings-auto-advance-inbox-after-organize"
      />
    </>
  )
}

function SettingsSwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  testId,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  testId?: string
}) {
  return (
    <label
      className="flex items-start justify-between gap-3"
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      data-testid={testId}
    >
      <div className="space-y-1">
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled} />
    </label>
  )
}

function TelemetryToggle({
  label,
  description,
  checked,
  onChange,
  testId,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  testId: string
}) {
  return (
    <label className="flex items-center gap-3" style={{ cursor: 'pointer' }} data-testid={testId}>
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(isChecked(value))} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{description}</div>
      </div>
    </label>
  )
}

function SettingsFooter({ onClose, onSave, t }: { onClose: () => void; onSave: () => void; t: Translate }) {
  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{ height: 56, padding: '0 24px', borderTop: '1px solid var(--border)' }}
    >
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{t('settings.footerShortcut')}</span>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose}>
          {t('settings.cancel')}
        </Button>
        <Button onClick={onSave} data-testid="settings-save">
          {t('settings.save')}
        </Button>
      </div>
    </div>
  )
}
