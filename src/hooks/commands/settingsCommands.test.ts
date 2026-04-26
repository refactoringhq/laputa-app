import { describe, expect, it, vi } from 'vitest'
import { formatShortcutDisplay } from '../appCommandCatalog'
import { buildSettingsCommands } from './settingsCommands'

describe('buildSettingsCommands', () => {
  it('adds a discoverable H1 auto-rename settings command', () => {
    const onOpenSettings = vi.fn()

    const commands = buildSettingsCommands({ onOpenSettings })
    const command = commands.find((item) => item.id === 'open-h1-auto-rename-setting')

    expect(command).toMatchObject({
      label: 'Open H1 Auto-Rename Setting',
      enabled: true,
      group: 'Settings',
    })

    command?.execute()
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
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
    const onOpenSettings = vi.fn()

    const commands = buildSettingsCommands({ onOpenSettings })
    const command = commands.find((item) => item.id === 'open-language-settings')

    expect(command).toMatchObject({
      label: 'Open Language Settings',
      enabled: true,
      group: 'Settings',
    })

    command?.execute()
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('adds language switch commands when a setter is available', () => {
    const onOpenSettings = vi.fn()
    const onSetUiLanguage = vi.fn()

    const commands = buildSettingsCommands({
      onOpenSettings,
      selectedUiLanguage: 'en',
      onSetUiLanguage,
    })

    const chinese = commands.find((item) => item.id === 'switch-language-zh-hans')
    expect(chinese).toMatchObject({
      label: 'Switch Language to Simplified Chinese',
      enabled: true,
    })

    chinese?.execute()
    expect(onSetUiLanguage).toHaveBeenCalledWith('zh-Hans')
  })

  it('adds quick theme mode commands when a setter is available', () => {
    const onSetThemeMode = vi.fn()

    const commands = buildSettingsCommands({
      onOpenSettings: vi.fn(),
      onSetThemeMode,
    })

    const lightMode = commands.find((item) => item.id === 'use-light-mode')
    const darkMode = commands.find((item) => item.id === 'use-dark-mode')

    expect(lightMode).toMatchObject({
      label: 'Use Light Mode',
      enabled: true,
      group: 'Settings',
    })
    expect(lightMode?.keywords).toContain('light mode')
    expect(darkMode).toMatchObject({
      label: 'Use Dark Mode',
      enabled: true,
      group: 'Settings',
    })
    expect(darkMode?.keywords).toContain('dark mode')

    lightMode?.execute()
    darkMode?.execute()

    expect(onSetThemeMode).toHaveBeenNthCalledWith(1, 'light')
    expect(onSetThemeMode).toHaveBeenNthCalledWith(2, 'dark')
  })

  it('localizes language commands', () => {
    const commands = buildSettingsCommands({
      onOpenSettings: vi.fn(),
      locale: 'zh-Hans',
      systemLocale: 'zh-Hans',
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
})
