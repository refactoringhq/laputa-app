import { test, expect, type Page } from '@playwright/test'
import { openCommandPalette, sendShortcut } from './helpers'

type MockHandlers = Record<string, (args?: unknown) => unknown>
type MockWindow = Window & {
  __resolveVaultScan?: () => void
}

const slowVaultEntries = [
  {
    path: '/vault/large-vault-note.md',
    filename: 'large-vault-note.md',
    title: 'Large Vault Note',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 1700000000,
    createdAt: 1700000000,
    fileSize: 128,
    snippet: 'A note that appears after the slow vault scan finishes.',
    wordCount: 12,
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
  },
]

async function installSlowVaultMock(page: Page): Promise<void> {
  await page.addInitScript((entries) => {
    localStorage.setItem('tolaria_welcome_dismissed', '1')
    localStorage.setItem('tolaria:ai-agents-onboarding-dismissed', '1')
    localStorage.setItem('tolaria:claude-code-onboarding-dismissed', '1')

    const mockWindow = window as MockWindow
    let handlers: MockHandlers | null = null
    const noteContent = {
      '/vault/large-vault-note.md': '# Large Vault Note\n\nLoaded content.',
    }
    const readCommandPath = (args: unknown) =>
      typeof (args as { path?: unknown })?.path === 'string'
        ? (args as { path: string }).path
        : ''
    let resolveSlowScan: ((value: unknown) => void) | null = null
    const slowScan = new Promise((resolve) => {
      resolveSlowScan = resolve
    })
    mockWindow.__resolveVaultScan = () => resolveSlowScan?.(entries)

    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      set(value: unknown) {
        handlers = value as MockHandlers
        handlers.load_vault_list = () => ({
          vaults: [{ label: 'Large Vault', path: '/vault' }],
          active_vault: '/vault',
          hidden_defaults: [],
        })
        handlers.check_vault_exists = () => true
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
        handlers.list_vault = () => slowScan
        handlers.list_vault_folders = () => []
        handlers.list_views = () => []
        handlers.get_modified_files = () => []
        handlers.get_all_content = () => noteContent
        handlers.get_note_content = (args: unknown) => noteContent[readCommandPath(args) as keyof typeof noteContent] ?? ''
      },
      get() {
        return handlers
      },
    })
  }, slowVaultEntries)
}

async function expectResponsiveShellWhileVaultLoads(page: Page): Promise<void> {
  await expect(page.getByTestId('sidebar-loading-favorites')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('vault-loading-skeleton')).not.toBeVisible()
  await expect(page.getByTestId('sidebar-top-nav')).toContainText('Inbox')
  await expect(page.getByTestId('sidebar-loading-views')).toBeVisible()
  await expect(page.getByTestId('sidebar-loading-types')).toBeVisible()
  await expect(page.getByTestId('sidebar-loading-folders')).toBeVisible()
  await expect(page.getByTestId('note-list-loading-skeleton')).toBeVisible()
  await expect(page.getByTestId('breadcrumb-title-skeleton')).toBeVisible()
  await expect(page.getByTestId('editor-content-skeleton')).toBeVisible()
  await expect(page.getByText('Select a note to start editing')).not.toBeVisible()
  await expect(page.getByTestId('status-vault-reloading')).toHaveAccessibleName('Reloading vault from disk')

  await sendShortcut(page, 'p', ['Control'])
  await expect(page.getByTestId('quick-open-palette')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('quick-open-palette').getByText('Reloading vault...')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('quick-open-palette')).not.toBeVisible()

  await openCommandPalette(page)
  await expect(page.locator('input[placeholder="Type a command..."]')).toBeVisible()
  await page.keyboard.press('Escape')
}

async function resolveVaultScan(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as MockWindow).__resolveVaultScan?.()
  })
}

async function expectLoadedVaultSearch(page: Page): Promise<void> {
  await expect(page.getByTestId('vault-loading-skeleton')).not.toBeVisible()
  await expect(page.getByTestId('status-vault-reloading')).not.toBeVisible()
  await expect(page.getByTestId('note-list-container')).toBeVisible()
  await expect(page.getByText('Large Vault Note')).toBeVisible()

  await sendShortcut(page, 'p', ['Control'])
  await expect(page.getByTestId('quick-open-palette')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('quick-open-palette').getByText('Large Vault Note')).toBeVisible()
}

test('slow vault open keeps the app shell usable while notes load @smoke', async ({ page }) => {
  await installSlowVaultMock(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expectResponsiveShellWhileVaultLoads(page)
  await resolveVaultScan(page)
  await expectLoadedVaultSearch(page)
})
