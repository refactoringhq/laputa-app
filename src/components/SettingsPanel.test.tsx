import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SettingsPanel } from './SettingsPanel'
import type { Settings } from '../types'
import { THEME_MODE_STORAGE_KEY } from '../lib/themeMode'

const emptySettings: Settings = {
  auto_pull_interval_minutes: null,
  autogit_enabled: null,
  autogit_idle_threshold_seconds: null,
  autogit_inactive_threshold_seconds: null,
  auto_advance_inbox_after_organize: null,
  telemetry_consent: null,
  crash_reporting_enabled: null,
  analytics_enabled: null,
  anonymous_id: null,
  release_channel: null,
  theme_mode: null,
  ui_language: null,
  default_ai_agent: null,
  hide_gitignored_files: null,
}

function installPointerCapturePolyfill() {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
}

function createStorageMock(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: vi.fn(() => { values.clear() }),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
}

describe('SettingsPanel', () => {
  const onSave = vi.fn()
  const onClose = vi.fn()
  const localStorageMock = createStorageMock()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('dark')
    installPointerCapturePolyfill()
  })

  it('renders nothing when not open', () => {
    const { container } = render(
      <SettingsPanel open={false} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders modal when open', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByText('Sync & Updates')).toBeInTheDocument()
  })

  it('updates the draft language when stored settings finish loading', () => {
    const { rerender } = render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    rerender(
      <SettingsPanel
        open={true}
        settings={{ ...emptySettings, ui_language: 'zh-CN' }}
        onSave={onSave}
        onClose={onClose}
      />
    )

    expect(screen.getByText('设置')).toBeInTheDocument()
    expect(screen.queryByText('Settings')).not.toBeInTheDocument()
  })

  it('calls onSave with stable defaults on save', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      auto_pull_interval_minutes: 5,
      autogit_enabled: false,
      autogit_idle_threshold_seconds: 90,
      autogit_inactive_threshold_seconds: 30,
      release_channel: null,
      theme_mode: 'light',
      hide_gitignored_files: true,
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('saves Gitignored content visibility immediately for keyboard close', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.click(screen.getByTestId('settings-hide-gitignored-files'))
    fireEvent.keyDown(screen.getByTestId('settings-panel'), { key: 'Escape' })

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      hide_gitignored_files: false,
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('defaults the color mode control to light', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    expect(screen.getByTestId('settings-theme-mode')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'false')
  })

  it('defaults the language selector to system language', () => {
    render(
      <SettingsPanel
        open={true}
        settings={emptySettings}
        locale="en"
        systemLocale="zh-CN"
        onSave={onSave}
        onClose={onClose}
      />
    )

    expect(screen.getByTestId('settings-ui-language')).toHaveAttribute('data-value', 'system')
    expect(screen.getByText('系统（简体中文）')).toBeInTheDocument()
  })

  it('keeps the language selector keyboard accessible', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    const trigger = screen.getByTestId('settings-ui-language')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' })

    expect(screen.getByRole('option', { name: 'Simplified Chinese' })).toBeInTheDocument()
  })

  it('saves the selected UI language and updates visible settings text', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.pointerDown(screen.getByTestId('settings-ui-language'), { button: 0, pointerType: 'mouse' })
    fireEvent.click(screen.getByRole('option', { name: 'Simplified Chinese' }))

    expect(screen.getByText('设置')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      ui_language: 'zh-CN',
    }))
  })

  it('uses the stored color mode mirror when settings have no saved mode', () => {
    window.localStorage.setItem(THEME_MODE_STORAGE_KEY, 'dark')

    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
  })

  it('saves the selected dark color mode', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      theme_mode: 'dark',
    }))
  })

  it('applies the selected dark color mode immediately while settings stays open', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(document.documentElement).toHaveClass('dark')
    expect(window.localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('dark')
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      theme_mode: 'dark',
    }))
  })

  it('preserves a saved dark color mode until changed', () => {
    render(
      <SettingsPanel
        open={true}
        settings={{ ...emptySettings, theme_mode: 'dark' }}
        onSave={onSave}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      theme_mode: 'dark',
    }))
  })

  it('defaults the release channel trigger to stable', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    expect(screen.getByTestId('settings-release-channel')).toHaveAttribute('data-value', 'stable')
    expect(screen.queryByText(/Beta\/Stable/i)).not.toBeInTheDocument()
  })

  it('anchors the default agent dropdown with the popper strategy', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.pointerDown(screen.getByTestId('settings-default-ai-agent'), { button: 0, pointerType: 'mouse' })

    expect(document.querySelector('[data-anchor-strategy="popper"]')).toBeInTheDocument()
  })

  it('keeps keyboard opening enabled for the default agent dropdown', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    const trigger = screen.getByTestId('settings-default-ai-agent')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' })

    expect(document.querySelector('[data-anchor-strategy="popper"]')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Codex/i })).toBeInTheDocument()
  })

  it('treats a legacy beta release channel as stable', () => {
    render(
      <SettingsPanel
        open={true}
        settings={{ ...emptySettings, release_channel: 'beta' }}
        onSave={onSave}
        onClose={onClose}
      />
    )

    expect(screen.getByTestId('settings-release-channel')).toHaveAttribute('data-value', 'stable')
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })

  it('preserves alpha when alpha is already selected', () => {
    const alphaSettings: Settings = {
      ...emptySettings,
      release_channel: 'alpha',
    }

    render(
      <SettingsPanel open={true} settings={alphaSettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      release_channel: 'alpha',
    }))
  })

  it('defaults the organization workflow switch to on', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    expect(screen.getByRole('switch', { name: 'Organize notes explicitly' })).toHaveAttribute('aria-checked', 'true')
  })

  it('defaults auto-advance to the next inbox item to off', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    expect(screen.getByRole('switch', { name: 'Auto-advance to next Inbox item' })).toHaveAttribute('aria-checked', 'false')
  })

  it('defaults the initial H1 auto-rename switch to on', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    expect(screen.getByRole('switch', { name: 'Auto-rename untitled notes from first H1' })).toHaveAttribute('aria-checked', 'true')
  })

  it('defaults AutoGit to off with recommended thresholds', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    expect(screen.getByRole('switch', { name: 'Enable AutoGit' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('settings-autogit-idle-threshold')).toHaveValue(90)
    expect(screen.getByTestId('settings-autogit-inactive-threshold')).toHaveValue(30)
  })

  it('saves AutoGit preferences when toggled and edited', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Enable AutoGit' }))
    fireEvent.change(screen.getByTestId('settings-autogit-idle-threshold'), { target: { value: '120' } })
    fireEvent.change(screen.getByTestId('settings-autogit-inactive-threshold'), { target: { value: '45' } })
    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      autogit_enabled: true,
      autogit_idle_threshold_seconds: 120,
      autogit_inactive_threshold_seconds: 45,
    }))
  })

  it('disables AutoGit controls when the current vault is not git-enabled', () => {
    render(
      <SettingsPanel
        open={true}
        settings={emptySettings}
        isGitVault={false}
        onSave={onSave}
        onClose={onClose}
      />
    )

    expect(screen.getByRole('switch', { name: 'Enable AutoGit' })).toBeDisabled()
    expect(screen.getByTestId('settings-autogit-idle-threshold')).toBeDisabled()
    expect(screen.getByTestId('settings-autogit-inactive-threshold')).toBeDisabled()
  })

  it('saves the initial H1 auto-rename preference when toggled off', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Auto-rename untitled notes from first H1' }))
    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      initial_h1_auto_rename_enabled: false,
    }))
  })

  it('saves the organization workflow preference when toggled off', () => {
    const onSaveExplicitOrganization = vi.fn()
    render(
      <SettingsPanel
        open={true}
        settings={emptySettings}
        onSave={onSave}
        explicitOrganizationEnabled={true}
        onSaveExplicitOrganization={onSaveExplicitOrganization}
        onClose={onClose}
      />
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Organize notes explicitly' }))
    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onSaveExplicitOrganization).toHaveBeenCalledWith(false)
  })

  it('saves the auto-advance inbox preference when toggled on', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )

    fireEvent.click(screen.getByRole('switch', { name: 'Auto-advance to next Inbox item' }))
    fireEvent.click(screen.getByTestId('settings-save'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      auto_advance_inbox_after_organize: true,
    }))
  })

  it('calls onClose when Cancel is clicked', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when close button is clicked', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    fireEvent.click(screen.getByTitle('Close settings'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Escape key', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    fireEvent.keyDown(screen.getByTestId('settings-panel'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('saves on Cmd+Enter', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    fireEvent.keyDown(screen.getByTestId('settings-panel'), { key: 'Enter', metaKey: true })

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      auto_pull_interval_minutes: 5,
    }))
  })

  it('calls onClose when clicking backdrop', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    fireEvent.click(screen.getByTestId('settings-panel'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows keyboard shortcut hint in footer', () => {
    render(
      <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
    )
    expect(screen.getByText(/to open settings/)).toBeInTheDocument()
  })

  it('copies the MCP config from the AI Agents section', () => {
    const onCopyMcpConfig = vi.fn()
    render(
      <SettingsPanel
        open={true}
        settings={emptySettings}
        onSave={onSave}
        onCopyMcpConfig={onCopyMcpConfig}
        onClose={onClose}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy MCP config' }))

    expect(onCopyMcpConfig).toHaveBeenCalledOnce()
  })

  describe('Privacy & Telemetry section', () => {
    it('renders crash reporting and analytics toggles', () => {
      render(
        <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
      )
      expect(screen.getByTestId('settings-crash-reporting')).toBeInTheDocument()
      expect(screen.getByTestId('settings-analytics')).toBeInTheDocument()
    })

    it('toggles reflect initial settings state', () => {
      const withTelemetry: Settings = {
        ...emptySettings,
        telemetry_consent: true,
        crash_reporting_enabled: true,
        analytics_enabled: false,
        anonymous_id: 'test-uuid',
      }
      render(
        <SettingsPanel open={true} settings={withTelemetry} onSave={onSave} onClose={onClose} />
      )

      const crashCheckbox = within(screen.getByTestId('settings-crash-reporting')).getByRole('checkbox')
      const analyticsCheckbox = within(screen.getByTestId('settings-analytics')).getByRole('checkbox')

      expect(crashCheckbox).toHaveAttribute('aria-checked', 'true')
      expect(analyticsCheckbox).toHaveAttribute('aria-checked', 'false')
    })

    it('saves telemetry settings when toggled and saved', () => {
      render(
        <SettingsPanel open={true} settings={emptySettings} onSave={onSave} onClose={onClose} />
      )

      fireEvent.click(within(screen.getByTestId('settings-crash-reporting')).getByRole('checkbox'))
      fireEvent.click(screen.getByTestId('settings-save'))

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        crash_reporting_enabled: true,
        analytics_enabled: false,
      }))
    })
  })
})
