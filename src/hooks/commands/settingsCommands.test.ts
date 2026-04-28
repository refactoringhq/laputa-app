import { describe, expect, it, vi } from 'vitest'
import { formatShortcutDisplay } from '../appCommandCatalog'
import { TOGGLE_GITIGNORED_VISIBILITY_EVENT } from '../../lib/gitignoredVisibilityEvents'
import { buildSettingsCommands } from './settingsCommands'

function findCommand(id: string, commands = buildSettingsCommands({ onOpenSettings: vi.fn() })) {
  return commands.find((item) => item.id === id)
}

function expectOpenSettingsCommand(id: string, label: string) {
  const onOpenSettings = vi.fn()
  const command = findCommand(id, buildSettingsCommands({ onOpenSettings }))

  expect(command).toMatchObject({
    label,
    enabled: true,
    group: 'Settings',
  })

  command?.execute()
  expect(onOpenSettings).toHaveBeenCalledTimes(1)
}

describe('buildSettingsCommands', () => {
  it('adds a discoverable H1 auto-rename settings command', () => {
    expectOpenSettingsCommand('open-h1-auto-rename-setting', 'Open H1 Auto-Rename Setting')
  })

  it('keeps the general settings command available', () => {
    const onOpenSettings = vi.fn()

    const commands = buildSettingsCommands({ onOpenSettings })

    expect(commands.find((item) => item.id === 'open-settings')).toMatchObject({
      label: 'Open Settings',
      shortcut: formatShortcutDisplay({ display: '⌘,' }),
      enabled: true,
    })
  })

  it('adds a discoverable language settings command', () => {
    expectOpenSettingsCommand('open-language-settings', 'Open Language Settings')
  })

  it('adds language switch commands when a setter is available', () => {
    const onOpenSettings = vi.fn()
    const onSetUiLanguage = vi.fn()

    const commands = buildSettingsCommands({
      onOpenSettings,
      selectedUiLanguage: 'en',
      onSetUiLanguage,
    })

    const chinese = commands.find((item) => item.id === 'switch-language-zh-cn')
    expect(chinese).toMatchObject({
      label: 'Switch Language to Simplified Chinese',
      enabled: true,
    })

    chinese?.execute()
    expect(onSetUiLanguage).toHaveBeenCalledWith('zh-CN')
  })

  it('localizes language commands', () => {
    const commands = buildSettingsCommands({
      onOpenSettings: vi.fn(),
      locale: 'zh-CN',
      systemLocale: 'zh-CN',
      selectedUiLanguage: 'system',
      onSetUiLanguage: vi.fn(),
    })

    expect(commands.find((item) => item.id === 'open-language-settings')).toMatchObject({
      label: '打开语言设置',
    })
    expect(commands.find((item) => item.id === 'use-system-language')).toMatchObject({
      label: '使用系统语言 (简体中文)',
      enabled: false,
    })
  })

  it('adds a create-empty-vault command when the handler is available', () => {
    const onOpenSettings = vi.fn()
    const onCreateEmptyVault = vi.fn()

    const commands = buildSettingsCommands({ onOpenSettings, onCreateEmptyVault })
    const command = commands.find((item) => item.id === 'create-empty-vault')

    expect(command).toMatchObject({
      label: 'Create Empty Vault…',
      enabled: true,
      group: 'Settings',
    })

    command?.execute()
    expect(onCreateEmptyVault).toHaveBeenCalledTimes(1)
  })

  it('adds a command palette toggle for Gitignored file visibility', () => {
    const onOpenSettings = vi.fn()
    const onToggleGitignoredFilesVisibility = vi.fn()

    const commands = buildSettingsCommands({
      onOpenSettings,
      onToggleGitignoredFilesVisibility,
    })
    const command = commands.find((item) => item.id === 'toggle-gitignored-files-visibility')

    expect(command).toMatchObject({
      label: 'Toggle Gitignored Files Visibility',
      enabled: true,
      group: 'Settings',
    })

    command?.execute()
    expect(onToggleGitignoredFilesVisibility).toHaveBeenCalledTimes(1)
  })

  it('dispatches the Gitignored visibility event when no direct handler is provided', () => {
    const listener = vi.fn()
    window.addEventListener(TOGGLE_GITIGNORED_VISIBILITY_EVENT, listener)

    findCommand('toggle-gitignored-files-visibility')?.execute()

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(TOGGLE_GITIGNORED_VISIBILITY_EVENT, listener)
  })
})
