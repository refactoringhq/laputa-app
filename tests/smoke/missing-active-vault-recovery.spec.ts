import { test, expect, type Page } from '@playwright/test'
import { executeCommand, openCommandPalette } from './helpers'

type MockHandlers = Record<string, (args?: unknown) => unknown>
type MockWindow = Window & {
  __markVaultMissing?: () => void
}

const entry = {
  path: '/vault/note/runtime.md',
  filename: 'runtime.md',
  title: 'Runtime Vault Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 64,
  snippet: 'Loaded before the vault path disappears.',
  wordCount: 7,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: true,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: true,
  fileKind: 'markdown',
}

async function installMissingVaultMock(page: Page): Promise<void> {
  await page.addInitScript((noteEntry: typeof entry) => {
    localStorage.setItem('tolaria_welcome_dismissed', '1')
    localStorage.setItem('tolaria:ai-agents-onboarding-dismissed', '1')
    localStorage.setItem('tolaria:claude-code-onboarding-dismissed', '1')

    const missingError = () => new Error('Active vault is not available')
    const mockWindow = window as MockWindow
    let vaultAvailable = true
    let handlers: MockHandlers | null = null

    mockWindow.__markVaultMissing = () => {
      vaultAvailable = false
    }

    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      set(value: unknown) {
        handlers = value as MockHandlers
        handlers.load_vault_list = () => ({
          vaults: [{ label: 'Runtime Vault', path: '/vault' }],
          active_vault: '/vault',
          hidden_defaults: [],
        })
        handlers.check_vault_exists = () => vaultAvailable
        handlers.get_default_vault_path = () => '/vault'
        handlers.get_settings = () => ({
          auto_pull_interval_minutes: null,
          auto_advance_inbox_after_organize: null,
          telemetry_consent: true,
          crash_reporting_enabled: null,
          analytics_enabled: null,
          anonymous_id: null,
          release_channel: null,
        })
        handlers.get_vault_settings = () => ({ theme: null })
        handlers.list_vault = () => vaultAvailable ? [noteEntry] : Promise.reject(new Error('No such file or directory'))
        handlers.reload_vault = () => vaultAvailable ? [noteEntry] : Promise.reject(new Error('No such file or directory'))
        handlers.list_vault_folders = () => vaultAvailable ? [] : Promise.reject(missingError())
        handlers.list_views = () => vaultAvailable ? [] : Promise.reject(missingError())
        handlers.get_modified_files = () => vaultAvailable ? [] : Promise.reject(missingError())
        handlers.get_all_content = () => ({ [noteEntry.path]: '# Runtime Vault Note\n\nBody.' })
        handlers.get_note_content = () => vaultAvailable
          ? '# Runtime Vault Note\n\nBody.'
          : Promise.reject(missingError())
        handlers.is_git_repo = () => true
        handlers.sync_mcp_bridge_vault = () => null
      },
      get() {
        return handlers
      },
    })
  }, entry)
}

test('missing active vault reload shows recovery state and clears stale notes @smoke', async ({ page }) => {
  await installMissingVaultMock(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByText('Runtime Vault Note')).toBeVisible({ timeout: 5_000 })

  await page.evaluate(() => {
    (window as MockWindow).__markVaultMissing?.()
  })
  await openCommandPalette(page)
  await executeCommand(page, 'Reload Vault')

  await expect(page.getByText('Vault not found')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('welcome-open-folder')).toContainText('Choose a different folder')
  await expect(page.getByText('Runtime Vault Note')).not.toBeVisible()
})
