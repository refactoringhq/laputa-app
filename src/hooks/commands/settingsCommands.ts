import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../appCommandCatalog'
import type { CommandAction } from './types'
import { rememberFeedbackDialogOpener } from '../../lib/feedbackDialogOpener'
import { requestGitignoredVisibilityToggle } from '../../lib/gitignoredVisibilityEvents'
import {
  APP_LOCALES,
  SYSTEM_UI_LANGUAGE,
  createTranslator,
  localeDisplayName,
  localeSearchKeywords,
  type AppLocale,
  type UiLanguagePreference,
} from '../../lib/i18n'

interface SettingsCommandsConfig {
  mcpStatus?: string
  vaultCount?: number
  isGettingStartedHidden?: boolean
  onOpenSettings: () => void
  onOpenFeedback?: () => void
  onOpenVault?: () => void
  onCreateEmptyVault?: () => void
  onRemoveActiveVault?: () => void
  onRestoreGettingStarted?: () => void
  onCheckForUpdates?: () => void
  onInstallMcp?: () => void
  onReloadVault?: () => void
  onRepairVault?: () => void
  onToggleGitignoredFilesVisibility?: () => void
  locale?: AppLocale
  systemLocale?: AppLocale
  selectedUiLanguage?: UiLanguagePreference
  onSetUiLanguage?: (language: UiLanguagePreference) => void
}

function commandKeywords(raw: string): string[] {
  return raw.split(/\s+/).filter(Boolean)
}

function buildPrimarySettingsCommands({
  locale = 'en',
  onOpenSettings,
  onOpenFeedback,
  onCheckForUpdates,
}: Pick<SettingsCommandsConfig, 'locale' | 'onOpenSettings' | 'onOpenFeedback' | 'onCheckForUpdates'>): CommandAction[] {
  const t = createTranslator(locale)
  return [
    {
      id: 'open-settings',
      label: t('command.openSettings'),
      group: 'Settings',
      shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.appSettings),
      keywords: commandKeywords(t('command.openSettings.keywords')),
      enabled: true,
      execute: onOpenSettings,
    },
    {
      id: 'open-h1-auto-rename-setting',
      label: t('command.openH1Setting'),
      group: 'Settings',
      keywords: ['h1', 'title', 'filename', 'rename', 'auto', 'untitled', 'sync', 'preference'],
      enabled: true,
      execute: onOpenSettings,
    },
    {
      id: 'open-contribute',
      label: t('command.contribute'),
      group: 'Settings',
      keywords: ['contribute', 'feedback', 'feature', 'canny', 'discussion', 'github', 'bug', 'report'],
      enabled: !!onOpenFeedback,
      execute: () => {
        rememberFeedbackDialogOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null)
        onOpenFeedback?.()
      },
    },
    { id: 'check-updates', label: t('command.checkUpdates'), group: 'Settings', keywords: ['update', 'version', 'upgrade', 'release'], enabled: true, execute: () => onCheckForUpdates?.() },
  ]
}

function buildLanguageCommands({
  locale = 'en',
  systemLocale = locale,
  selectedUiLanguage = SYSTEM_UI_LANGUAGE,
  onOpenSettings,
  onSetUiLanguage,
}: Pick<SettingsCommandsConfig, 'locale' | 'systemLocale' | 'selectedUiLanguage' | 'onOpenSettings' | 'onSetUiLanguage'>): CommandAction[] {
  const t = createTranslator(locale)
  const canSwitchLanguage = !!onSetUiLanguage

  return [
    {
      id: 'open-language-settings',
      label: t('command.openLanguageSettings'),
      group: 'Settings',
      keywords: commandKeywords(t('command.openLanguageSettings.keywords')),
      enabled: true,
      execute: onOpenSettings,
    },
    {
      id: 'use-system-language',
      label: `${t('command.useSystemLanguage')} (${localeDisplayName(systemLocale, locale)})`,
      group: 'Settings',
      keywords: ['language', 'locale', 'system', 'auto'],
      enabled: canSwitchLanguage && selectedUiLanguage !== SYSTEM_UI_LANGUAGE,
      execute: () => onSetUiLanguage?.(SYSTEM_UI_LANGUAGE),
    },
    ...APP_LOCALES.map((targetLocale) => ({
      id: `switch-language-${targetLocale.toLowerCase()}`,
      label: t('command.switchLanguage', {
        language: localeDisplayName(targetLocale, locale),
      }),
      group: 'Settings' as const,
      keywords: [
        'language',
        'locale',
        ...localeSearchKeywords(targetLocale),
      ],
      enabled: canSwitchLanguage && selectedUiLanguage !== targetLocale,
      execute: () => onSetUiLanguage?.(targetLocale),
    })),
  ]
}

function buildVaultSettingsCommands({
  vaultCount,
  isGettingStartedHidden,
  onOpenVault,
  onCreateEmptyVault,
  onRemoveActiveVault,
  onRestoreGettingStarted,
}: Pick<SettingsCommandsConfig, 'vaultCount' | 'isGettingStartedHidden' | 'onOpenVault' | 'onCreateEmptyVault' | 'onRemoveActiveVault' | 'onRestoreGettingStarted'>): CommandAction[] {
  return [
    { id: 'create-empty-vault', label: 'Create Empty Vault…', group: 'Settings', keywords: ['vault', 'create', 'new', 'empty', 'folder'], enabled: !!onCreateEmptyVault, execute: () => onCreateEmptyVault?.() },
    { id: 'open-vault', label: 'Open Vault…', group: 'Settings', keywords: ['vault', 'folder', 'switch', 'open', 'workspace'], enabled: true, execute: () => onOpenVault?.() },
    { id: 'remove-vault', label: 'Remove Vault from List', group: 'Settings', keywords: ['vault', 'remove', 'disconnect', 'hide'], enabled: (vaultCount ?? 0) > 1 && !!onRemoveActiveVault, execute: () => onRemoveActiveVault?.() },
    { id: 'restore-getting-started', label: 'Restore Getting Started Vault', group: 'Settings', keywords: ['vault', 'restore', 'demo', 'getting started', 'reset'], enabled: !!isGettingStartedHidden && !!onRestoreGettingStarted, execute: () => onRestoreGettingStarted?.() },
  ]
}

function buildMaintenanceCommands({
  mcpStatus,
  onInstallMcp,
  onReloadVault,
  onRepairVault,
  onToggleGitignoredFilesVisibility,
}: Pick<SettingsCommandsConfig, 'mcpStatus' | 'onInstallMcp' | 'onReloadVault' | 'onRepairVault' | 'onToggleGitignoredFilesVisibility'>): CommandAction[] {
  return [
    {
      id: 'install-mcp',
      label: mcpStatus === 'installed' ? 'Manage External AI Tools…' : 'Set Up External AI Tools…',
      group: 'Settings',
      keywords: ['mcp', 'ai', 'tools', 'external', 'setup', 'details', 'copy', 'export', 'manual', 'config', 'connect', 'disconnect', 'claude', 'gemini', 'codex', 'cursor', 'consent'],
      enabled: true,
      execute: () => onInstallMcp?.(),
    },
    {
      id: 'toggle-gitignored-files-visibility',
      label: 'Toggle Gitignored Files Visibility',
      group: 'Settings',
      keywords: ['gitignore', 'ignored', 'files', 'folders', 'visibility', 'hide', 'show', 'generated', 'local'],
      enabled: true,
      execute: onToggleGitignoredFilesVisibility ?? requestGitignoredVisibilityToggle,
    },
    { id: 'reload-vault', label: 'Reload Vault', group: 'Settings', keywords: ['reload', 'refresh', 'rescan', 'sync', 'filesystem', 'cache'], enabled: !!onReloadVault, execute: () => onReloadVault?.() },
    { id: 'repair-vault', label: 'Repair Vault', group: 'Settings', keywords: ['repair', 'fix', 'restore', 'config', 'agents', 'themes', 'missing', 'reset', 'flatten', 'structure'], enabled: !!onRepairVault, execute: () => onRepairVault?.() },
  ]
}

export function buildSettingsCommands(config: SettingsCommandsConfig): CommandAction[] {
  const {
    mcpStatus, vaultCount, isGettingStartedHidden,
    onOpenSettings, onOpenFeedback, onOpenVault, onCreateEmptyVault, onRemoveActiveVault, onRestoreGettingStarted,
    onCheckForUpdates, onInstallMcp, onReloadVault, onRepairVault, onToggleGitignoredFilesVisibility,
    locale = 'en', systemLocale = locale, selectedUiLanguage = SYSTEM_UI_LANGUAGE, onSetUiLanguage,
  } = config

  return [
    ...buildPrimarySettingsCommands({ locale, onOpenSettings, onOpenFeedback, onCheckForUpdates }),
    ...buildLanguageCommands({
      locale,
      systemLocale,
      selectedUiLanguage,
      onOpenSettings,
      onSetUiLanguage,
    }),
    ...buildVaultSettingsCommands({
      vaultCount,
      isGettingStartedHidden,
      onOpenVault,
      onCreateEmptyVault,
      onRemoveActiveVault,
      onRestoreGettingStarted,
    }),
    ...buildMaintenanceCommands({
      mcpStatus,
      onInstallMcp,
      onReloadVault,
      onRepairVault,
      onToggleGitignoredFilesVisibility,
    }),
  ]
}
