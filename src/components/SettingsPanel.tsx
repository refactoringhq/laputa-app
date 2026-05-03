import {
  AI_AGENT_DEFINITIONS,
  createMissingAiAgentsStatus,
  getAiAgentDefinition,
  resolveDefaultAiAgent,
  type AiAgentId,
  type AiAgentsStatus,
} from '../lib/aiAgents'
import {
  agentTargetId,
  configuredModelTargets,
  normalizeAiModelProviders,
  resolveAiTarget,
  type AiModelProvider,
} from '../lib/aiTargets'
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { Moon, Sun, X } from '@phosphor-icons/react'
import { Bot, Copy, Folder, GitBranch, ListChecks, Palette, RefreshCw, ShieldCheck } from 'lucide-react'
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
import { trackAllNotesVisibilityChanged } from '../lib/productAnalytics'
import { AiProviderSettings } from './AiProviderSettings'
import { PrivacySettingsSection } from './PrivacySettingsSection'
import {
  NumberInputControl,
  SectionHeading,
  SelectControl,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from './SettingsControls'
import { SettingsFooter } from './SettingsFooter'
import {
  resolveAllNotesFileVisibility,
  settingsWithAllNotesFileVisibility,
  type AllNotesFileVisibility,
} from '../utils/allNotesFileVisibility'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

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
  defaultAiTarget: string
  aiModelProviders: AiModelProvider[]
  releaseChannel: ReleaseChannel
  themeMode: ThemeMode
  uiLanguage: UiLanguagePreference
  initialH1AutoRename: boolean
  hideGitignoredFiles: boolean
  allNotesFileVisibility: AllNotesFileVisibility
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
  defaultAiTarget: string
  setDefaultAiTarget: (value: string) => void
  aiModelProviders: AiModelProvider[]
  setAiModelProviders: (value: AiModelProvider[]) => void
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
  allNotesFileVisibility: AllNotesFileVisibility
  setAllNotesFileVisibility: (value: AllNotesFileVisibility) => void
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
const SETTINGS_SECTION_IDS = {
  sync: 'settings-section-sync',
  autogit: 'settings-section-autogit',
  appearance: 'settings-section-appearance',
  content: 'settings-section-content',
  ai: 'settings-section-ai',
  workflow: 'settings-section-workflow',
  privacy: 'settings-section-privacy',
} as const
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
    defaultAiTarget: resolveAiTarget(settings).id,
    aiModelProviders: normalizeAiModelProviders(settings.ai_model_providers),
    releaseChannel: normalizeReleaseChannel(settings.release_channel),
    themeMode: resolveSettingsDraftThemeMode(settings.theme_mode),
    uiLanguage: settings.ui_language ?? SYSTEM_UI_LANGUAGE,
    initialH1AutoRename: settings.initial_h1_auto_rename_enabled ?? true,
    hideGitignoredFiles: shouldHideGitignoredFiles(settings),
    allNotesFileVisibility: resolveAllNotesFileVisibility(settings),
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
  const nextSettings = {
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
    default_ai_target: draft.defaultAiTarget,
    ai_model_providers: draft.aiModelProviders.length > 0 ? draft.aiModelProviders : null,
    hide_gitignored_files: draft.hideGitignoredFiles,
  }
  return settingsWithAllNotesFileVisibility(nextSettings, draft.allNotesFileVisibility)
}

function trackTelemetryConsentChange(previousAnalytics: boolean, nextAnalytics: boolean): void {
  if (!previousAnalytics && nextAnalytics) trackEvent('telemetry_opted_in')
  if (previousAnalytics && !nextAnalytics) trackEvent('telemetry_opted_out')
}

function sanitizePositiveInteger(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 1) return fallback
  return Math.round(value)
}

function applyThemeModeSelection(value: ThemeMode): void {
  if (typeof document !== 'undefined') applyThemeModeToDocument(document, value)
  if (typeof window !== 'undefined') writeStoredThemeMode(window.localStorage, value)
}

function useSettingsPanelAutofocus(panelRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      const focusTarget = panelRef.current?.querySelector<HTMLElement>('[data-settings-autofocus="true"]')
      focusTarget?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [panelRef])
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

  useSettingsPanelAutofocus(panelRef)

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

  const handleAllNotesFileVisibilityChange = useCallback((value: AllNotesFileVisibility) => {
    trackAllNotesVisibilityChanged(draft.allNotesFileVisibility, value)
    updateDraft('allNotesFileVisibility', value)
    onSave(settingsWithAllNotesFileVisibility(settings, value))
  }, [draft.allNotesFileVisibility, onSave, settings, updateDraft])

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
        style={{ width: 'min(960px, calc(100vw - 48px))', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}
      >
        <SettingsHeader onClose={onClose} t={t} />
        <SettingsBodyFromDraft
          t={t}
          draft={draft}
          locale={draftLocale}
          systemLocale={systemLocale}
          updateDraft={updateDraft}
          isGitVault={isGitVault}
          aiAgentsStatus={aiAgentsStatus}
          onCopyMcpConfig={onCopyMcpConfig}
          setThemeMode={handleThemeModeChange}
          setHideGitignoredFiles={handleGitignoredVisibilityChange}
          setAllNotesFileVisibility={handleAllNotesFileVisibilityChange}
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

interface SettingsBodyFromDraftProps {
  t: Translate
  draft: SettingsDraft
  locale: AppLocale
  systemLocale: AppLocale
  updateDraft: <Key extends keyof SettingsDraft>(key: Key, value: SettingsDraft[Key]) => void
  isGitVault: boolean
  aiAgentsStatus: AiAgentsStatus
  onCopyMcpConfig?: () => void
  setThemeMode: (value: ThemeMode) => void
  setHideGitignoredFiles: (value: boolean) => void
  setAllNotesFileVisibility: (value: AllNotesFileVisibility) => void
}

function SettingsBodyFromDraft({
  t,
  draft,
  locale,
  systemLocale,
  updateDraft,
  isGitVault,
  aiAgentsStatus,
  onCopyMcpConfig,
  setThemeMode,
  setHideGitignoredFiles,
  setAllNotesFileVisibility,
}: SettingsBodyFromDraftProps) {
  return (
    <SettingsBody
      t={t}
      locale={locale}
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
      defaultAiTarget={draft.defaultAiTarget}
      setDefaultAiTarget={(value) => updateDraft('defaultAiTarget', value)}
      aiModelProviders={draft.aiModelProviders}
      setAiModelProviders={(value) => updateDraft('aiModelProviders', value)}
      onCopyMcpConfig={onCopyMcpConfig}
      releaseChannel={draft.releaseChannel}
      setReleaseChannel={(value) => updateDraft('releaseChannel', value)}
      themeMode={draft.themeMode}
      setThemeMode={setThemeMode}
      uiLanguage={draft.uiLanguage}
      setUiLanguage={(value) => updateDraft('uiLanguage', value)}
      initialH1AutoRename={draft.initialH1AutoRename}
      setInitialH1AutoRename={(value) => updateDraft('initialH1AutoRename', value)}
      hideGitignoredFiles={draft.hideGitignoredFiles}
      setHideGitignoredFiles={setHideGitignoredFiles}
      allNotesFileVisibility={draft.allNotesFileVisibility}
      setAllNotesFileVisibility={setAllNotesFileVisibility}
      explicitOrganization={draft.explicitOrganization}
      setExplicitOrganization={(value) => updateDraft('explicitOrganization', value)}
      crashReporting={draft.crashReporting}
      setCrashReporting={(value) => updateDraft('crashReporting', value)}
      analytics={draft.analytics}
      setAnalytics={(value) => updateDraft('analytics', value)}
    />
  )
}

function SettingsBody(props: SettingsBodyProps) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <SettingsBodyNav t={props.t} />
      <div className="min-w-0 flex-1 overflow-auto px-6 py-4">
        <SettingsSyncAndAppearanceSections {...props} />
        <SettingsContentSections {...props} />
        <SettingsAgentWorkflowSections {...props} />
      </div>
    </div>
  )
}

function SettingsBodyNav({ t }: { t: Translate }) {
  const items = [
    { id: SETTINGS_SECTION_IDS.sync, label: t('settings.sync.title'), Icon: RefreshCw },
    { id: SETTINGS_SECTION_IDS.autogit, label: t('settings.autogit.title'), Icon: GitBranch },
    { id: SETTINGS_SECTION_IDS.appearance, label: t('settings.appearance.title'), Icon: Palette },
    { id: SETTINGS_SECTION_IDS.content, label: t('settings.vaultContent.title'), Icon: Folder },
    { id: SETTINGS_SECTION_IDS.ai, label: t('settings.aiAgents.title'), Icon: Bot },
    { id: SETTINGS_SECTION_IDS.workflow, label: t('settings.workflow.title'), Icon: ListChecks },
    { id: SETTINGS_SECTION_IDS.privacy, label: t('settings.privacy.title'), Icon: ShieldCheck },
  ]

  return (
    <div className="hidden w-48 shrink-0 border-r border-border px-3 py-4 md:block">
      <div className="sticky top-0 space-y-1.5">
        {items.map((item) => (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            size="sm"
            className="h-10 w-full justify-start gap-2.5 px-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            onClick={() => document.getElementById(item.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
          >
            <item.Icon size={16} className="shrink-0" />
            <span className="truncate">{item.label}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}

function SettingsSyncAndAppearanceSections({
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
  releaseChannel,
  setReleaseChannel,
  themeMode,
  setThemeMode,
  uiLanguage,
  setUiLanguage,
}: SettingsBodyProps) {
  return (
    <>
      <SettingsSection id={SETTINGS_SECTION_IDS.sync} showDivider={false}>
        <SyncAndUpdatesSection
          t={t}
          pullInterval={pullInterval}
          setPullInterval={setPullInterval}
          releaseChannel={releaseChannel}
          setReleaseChannel={setReleaseChannel}
        />
      </SettingsSection>
      <SettingsSection id={SETTINGS_SECTION_IDS.autogit}>
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

      <SettingsSection id={SETTINGS_SECTION_IDS.appearance}>
        <SectionHeading title={t('settings.appearance.title')} />
        <SettingsGroup>
          <AppearanceSettingsSection
            t={t}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
          />
          <LanguageSettingsSection
            t={t}
            locale={locale}
            systemLocale={systemLocale}
            uiLanguage={uiLanguage}
            setUiLanguage={setUiLanguage}
          />
        </SettingsGroup>
      </SettingsSection>
    </>
  )
}

function SettingsContentSections({
  t,
  initialH1AutoRename,
  setInitialH1AutoRename,
  hideGitignoredFiles,
  setHideGitignoredFiles,
  allNotesFileVisibility,
  setAllNotesFileVisibility,
}: SettingsBodyProps) {
  return (
    <SettingsSection id={SETTINGS_SECTION_IDS.content}>
      <VaultContentSettingsSection
        t={t}
        initialH1AutoRename={initialH1AutoRename}
        setInitialH1AutoRename={setInitialH1AutoRename}
        hideGitignoredFiles={hideGitignoredFiles}
        setHideGitignoredFiles={setHideGitignoredFiles}
        allNotesFileVisibility={allNotesFileVisibility}
        setAllNotesFileVisibility={setAllNotesFileVisibility}
      />
    </SettingsSection>
  )
}

function SettingsAgentWorkflowSections({
  t,
  autoAdvanceInboxAfterOrganize,
  setAutoAdvanceInboxAfterOrganize,
  aiAgentsStatus,
  defaultAiAgent,
  setDefaultAiAgent,
  defaultAiTarget,
  setDefaultAiTarget,
  aiModelProviders,
  setAiModelProviders,
  onCopyMcpConfig,
  explicitOrganization,
  setExplicitOrganization,
  crashReporting,
  setCrashReporting,
  analytics,
  setAnalytics,
}: SettingsBodyProps) {
  return (
    <>
      <SettingsSection id={SETTINGS_SECTION_IDS.ai}>
        <AiAgentSettingsSection
          t={t}
          aiAgentsStatus={aiAgentsStatus}
          defaultAiAgent={defaultAiAgent}
          setDefaultAiAgent={setDefaultAiAgent}
          defaultAiTarget={defaultAiTarget}
          setDefaultAiTarget={setDefaultAiTarget}
          aiModelProviders={aiModelProviders}
          setAiModelProviders={setAiModelProviders}
          onCopyMcpConfig={onCopyMcpConfig}
        />
      </SettingsSection>

      <SettingsSection id={SETTINGS_SECTION_IDS.workflow}>
        <OrganizationWorkflowSection
          t={t}
          checked={explicitOrganization}
          onChange={setExplicitOrganization}
          autoAdvanceInboxAfterOrganize={autoAdvanceInboxAfterOrganize}
          onChangeAutoAdvanceInboxAfterOrganize={setAutoAdvanceInboxAfterOrganize}
        />
      </SettingsSection>

      <SettingsSection id={SETTINGS_SECTION_IDS.privacy}>
        <PrivacySettingsSection
          t={t}
          crashReporting={crashReporting}
          setCrashReporting={setCrashReporting}
          analytics={analytics}
          setAnalytics={setAnalytics}
        />
      </SettingsSection>
    </>
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
      />

      <SettingsGroup>
        <SettingsRow label={t('settings.pullInterval')} description={t('settings.pullIntervalDescription')}>
          <SelectControl
            ariaLabel={t('settings.pullInterval')}
            value={`${pullInterval}`}
            onValueChange={(value) => setPullInterval(Number(value))}
            options={PULL_INTERVAL_OPTIONS.map((value) => ({
              value: `${value}`,
              label: `${value}`,
            }))}
            testId="settings-pull-interval"
            autoFocus={true}
          />
        </SettingsRow>

        <SettingsRow label={t('settings.releaseChannel')} description={t('settings.releaseChannelDescription')}>
          <SelectControl
            ariaLabel={t('settings.releaseChannel')}
            value={releaseChannel}
            onValueChange={(value) => setReleaseChannel(value as ReleaseChannel)}
            options={[
              { value: 'stable', label: t('settings.releaseStable') },
              { value: 'alpha', label: t('settings.releaseAlpha') },
            ]}
            testId="settings-release-channel"
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}

function AppearanceSettingsSection({
  t,
  themeMode,
  setThemeMode,
}: Pick<SettingsBodyProps, 't' | 'themeMode' | 'setThemeMode'>) {
  return (
    <SettingsRow label={t('settings.theme.label')} description={t('settings.appearance.description')}>
      <ThemeModeControl value={themeMode} onChange={setThemeMode} t={t} />
    </SettingsRow>
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
      />

      <SettingsGroup>
        <SettingsSwitchRow
          label={t('settings.autogit.enable')}
          description={isGitVault ? t('settings.autogit.enableDescription') : autoGitSectionDescription(isGitVault, t)}
          checked={autoGitEnabled}
          onChange={setAutoGitEnabled}
          disabled={!isGitVault}
          testId="settings-autogit-enabled"
        />

        <SettingsRow
          label={t('settings.autogit.idleThreshold')}
          description={t('settings.autogit.idleThresholdDescription')}
          controlWidth="compact"
        >
          <NumberInputControl
            ariaLabel={t('settings.autogit.idleThreshold')}
            value={autoGitIdleThresholdSeconds}
            onValueChange={setAutoGitIdleThresholdSeconds}
            testId="settings-autogit-idle-threshold"
            disabled={!isGitVault}
          />
        </SettingsRow>

        <SettingsRow
          label={t('settings.autogit.inactiveThreshold')}
          description={t('settings.autogit.inactiveThresholdDescription')}
          controlWidth="compact"
        >
          <NumberInputControl
            ariaLabel={t('settings.autogit.inactiveThreshold')}
            value={autoGitInactiveThresholdSeconds}
            onValueChange={setAutoGitInactiveThresholdSeconds}
            testId="settings-autogit-inactive-threshold"
            disabled={!isGitVault}
          />
        </SettingsRow>
      </SettingsGroup>
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
    <SettingsRow
      label={t('settings.language.title')}
      description={`${t('settings.language.description')} ${t('settings.language.summary')}`}
    >
      <SelectControl
        ariaLabel={t('settings.language.label')}
        value={uiLanguage}
        onValueChange={(value) => setUiLanguage(value as UiLanguagePreference)}
        options={buildLanguageOptions(t, locale, systemLocale)}
        testId="settings-ui-language"
      />
    </SettingsRow>
  )
}

function VaultContentSettingsSection({
  t,
  initialH1AutoRename,
  setInitialH1AutoRename,
  hideGitignoredFiles,
  setHideGitignoredFiles,
  allNotesFileVisibility,
  setAllNotesFileVisibility,
}: Pick<
  SettingsBodyProps,
  | 't'
  | 'initialH1AutoRename'
  | 'setInitialH1AutoRename'
  | 'hideGitignoredFiles'
  | 'setHideGitignoredFiles'
  | 'allNotesFileVisibility'
  | 'setAllNotesFileVisibility'
>) {
  const updateAllNotesFileVisibility = (patch: Partial<AllNotesFileVisibility>) => {
    setAllNotesFileVisibility({ ...allNotesFileVisibility, ...patch })
  }

  return (
    <>
      <SectionHeading
        title={t('settings.vaultContent.title')}
      />

      <SettingsGroup>
        <SettingsSwitchRow
          label={t('settings.titles.autoRename')}
          description={t('settings.titles.autoRenameDescription')}
          checked={initialH1AutoRename}
          onChange={setInitialH1AutoRename}
          testId="settings-initial-h1-auto-rename"
        />

        <SettingsSwitchRow
          label={t('settings.vaultContent.hideGitignored')}
          description={t('settings.vaultContent.hideGitignoredDescription')}
          checked={hideGitignoredFiles}
          onChange={setHideGitignoredFiles}
          testId="settings-hide-gitignored-files"
        />

        <SettingsSwitchRow
          label={t('settings.allNotesVisibility.pdfs')}
          description={t('settings.allNotesVisibility.pdfsDescription')}
          checked={allNotesFileVisibility.pdfs}
          onChange={(checked) => updateAllNotesFileVisibility({ pdfs: checked })}
          testId="settings-all-notes-show-pdfs"
        />

        <SettingsSwitchRow
          label={t('settings.allNotesVisibility.images')}
          description={t('settings.allNotesVisibility.imagesDescription')}
          checked={allNotesFileVisibility.images}
          onChange={(checked) => updateAllNotesFileVisibility({ images: checked })}
          testId="settings-all-notes-show-images"
        />

        <SettingsSwitchRow
          label={t('settings.allNotesVisibility.unsupported')}
          description={t('settings.allNotesVisibility.unsupportedDescription')}
          checked={allNotesFileVisibility.unsupported}
          onChange={(checked) => updateAllNotesFileVisibility({ unsupported: checked })}
          testId="settings-all-notes-show-unsupported"
        />
      </SettingsGroup>
    </>
  )
}

function buildDefaultAiTargetOptions(
  aiAgentsStatus: AiAgentsStatus,
  providers: AiModelProvider[],
  t: Translate,
): Array<{ value: string; label: string }> {
  const agentOptions = AI_AGENT_DEFINITIONS.map((definition) => {
    const status = aiAgentsStatus[definition.id]
    const suffix = status.status === 'installed'
      ? ` (${t('settings.aiAgents.installed')}${status.version ? ` ${status.version}` : ''})`
      : ` (${t('settings.aiAgents.missing')})`
    return {
      value: agentTargetId(definition.id),
      label: `${t('settings.aiAgents.agentGroup')}: ${definition.label}${suffix}`,
    }
  })
  const modelOptions = configuredModelTargets(providers).map((target) => ({
    value: target.id,
    label: `${target.provider.kind === 'ollama' || target.provider.kind === 'lm_studio' ? t('settings.aiAgents.localGroup') : t('settings.aiAgents.apiGroup')}: ${target.label}`,
  }))
  return [...agentOptions, ...modelOptions]
}

function AiAgentSettingsSection({
  t,
  aiAgentsStatus,
  defaultAiAgent,
  setDefaultAiAgent,
  defaultAiTarget,
  setDefaultAiTarget,
  aiModelProviders,
  setAiModelProviders,
  onCopyMcpConfig,
}: Pick<
  SettingsBodyProps,
  | 't'
  | 'aiAgentsStatus'
  | 'defaultAiAgent'
  | 'setDefaultAiAgent'
  | 'defaultAiTarget'
  | 'setDefaultAiTarget'
  | 'aiModelProviders'
  | 'setAiModelProviders'
  | 'onCopyMcpConfig'
>) {
  const selectedTarget = resolveAiTarget({
    default_ai_agent: defaultAiAgent,
    default_ai_target: defaultAiTarget,
    ai_model_providers: aiModelProviders,
  } as Settings)

  return (
    <>
      <SectionHeading
        title={t('settings.aiAgents.title')}
      />

      <SettingsGroup>
        <SettingsRow
          label={t('settings.aiAgents.defaultTarget')}
          description={renderDefaultAiTargetSummary(selectedTarget, aiAgentsStatus, t)}
          controlWidth="wide"
        >
          <SelectControl
            ariaLabel={t('settings.aiAgents.defaultTarget')}
            value={defaultAiTarget}
            onValueChange={(value) => {
              setDefaultAiTarget(value)
              if (value.startsWith('agent:')) {
                const agent = value.replace('agent:', '') as AiAgentId
                setDefaultAiAgent(agent)
              }
            }}
            options={buildDefaultAiTargetOptions(aiAgentsStatus, aiModelProviders, t)}
            testId="settings-default-ai-agent"
          />
        </SettingsRow>
      </SettingsGroup>

      <AiTargetManagementTabs
        t={t}
        aiAgentsStatus={aiAgentsStatus}
        aiModelProviders={aiModelProviders}
        setAiModelProviders={setAiModelProviders}
        onCopyMcpConfig={onCopyMcpConfig}
      />
    </>
  )
}

function AiTargetManagementTabs({
  t,
  aiAgentsStatus,
  aiModelProviders,
  setAiModelProviders,
  onCopyMcpConfig,
}: {
  t: Translate
  aiAgentsStatus: AiAgentsStatus
  aiModelProviders: AiModelProvider[]
  setAiModelProviders: (value: AiModelProvider[]) => void
  onCopyMcpConfig?: () => void
}) {
  return (
    <Tabs defaultValue="agents" className="gap-3">
      <TabsList className="grid h-9 w-full grid-cols-3">
        <TabsTrigger value="agents">{t('settings.aiAgents.agentGroup')}</TabsTrigger>
        <TabsTrigger value="local">{t('settings.aiAgents.localGroup')}</TabsTrigger>
        <TabsTrigger value="api">{t('settings.aiAgents.apiGroup')}</TabsTrigger>
      </TabsList>
      <TabsContent value="agents" className="space-y-3">
        <AiAgentsInstalledSection t={t} aiAgentsStatus={aiAgentsStatus} />
        {onCopyMcpConfig ? <CopyMcpConfigButton t={t} onCopyMcpConfig={onCopyMcpConfig} /> : null}
      </TabsContent>
      <TabsContent value="local">
        <AiProviderSettings t={t} mode="local" providers={aiModelProviders} onChange={setAiModelProviders} />
      </TabsContent>
      <TabsContent value="api">
        <AiProviderSettings t={t} mode="api" providers={aiModelProviders} onChange={setAiModelProviders} />
      </TabsContent>
    </Tabs>
  )
}

function CopyMcpConfigButton({
  t,
  onCopyMcpConfig,
}: {
  t: Translate
  onCopyMcpConfig: () => void
}) {
  return (
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
  )
}

function AiAgentsInstalledSection({
  t,
  aiAgentsStatus,
}: {
  t: Translate
  aiAgentsStatus: AiAgentsStatus
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-sm font-medium text-foreground">{t('settings.aiAgents.installedTitle')}</div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{t('settings.aiAgents.installedDescription')}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {AI_AGENT_DEFINITIONS.map((definition) => {
          const status = aiAgentsStatus[definition.id]
          const installed = status.status === 'installed'
          return (
            <div key={definition.id} className="rounded-md border border-border bg-background px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate text-sm font-medium text-foreground">{definition.label}</div>
                <div className={installed ? 'text-xs text-emerald-700' : 'text-xs text-muted-foreground'}>
                  {installed ? t('settings.aiAgents.installed') : t('settings.aiAgents.missing')}
                </div>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {status.version || t('settings.aiAgents.noVersion')}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
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

function renderDefaultAiTargetSummary(target: ReturnType<typeof resolveAiTarget>, aiAgentsStatus: AiAgentsStatus, t: Translate): string {
  if (target.kind === 'api_model') {
    const storage = target.provider.api_key_storage === 'local_file'
      ? t('settings.aiAgents.apiLocalKey')
      : target.provider.api_key_env_var
      ? t('settings.aiAgents.apiEnv', { env: target.provider.api_key_env_var })
      : t('settings.aiAgents.apiNoKey')
    return t('settings.aiAgents.apiReady', { target: target.label, storage })
  }
  return renderDefaultAiAgentSummary(target.agent, aiAgentsStatus, t)
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
      />

      <SettingsGroup>
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
      </SettingsGroup>
    </>
  )
}
