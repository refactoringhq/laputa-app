import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'

type CommandArgs = Record<string, unknown> | undefined
type CommandHandler = (args?: CommandArgs) => unknown
type HandlerMap = Record<string, CommandHandler>

interface TauriInternals {
  invoke: (command: string, args?: CommandArgs) => Promise<unknown>
  transformCallback: () => string
  unregisterCallback: () => void
}

type StartupWindow = Window & typeof globalThis & {
  __mockHandlers?: HandlerMap
  __startupReloadCount?: () => number
  __TAURI_INTERNALS__?: TauriInternals
}

const activeVaultPath = path.join(process.cwd(), 'demo-vault-v2')
const starterVaultPath = path.join(process.cwd(), 'mock-getting-started')
const recoveredNotePath = path.join(activeVaultPath, 'startup-recovered.md')
const recoveredEntry = {
  path: recoveredNotePath,
  filename: 'startup-recovered.md',
  title: 'Recovered Startup Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1_700_000_000,
  createdAt: 1_700_000_000,
  fileSize: 64,
  snippet: 'Recovered after the startup reload.',
  wordCount: 6,
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

async function installStartupRecoveryMock(page: Page): Promise<void> {
  await page.addInitScript(({ defaultPath, vaultPath, noteEntry }) => {
    localStorage.setItem('tolaria_welcome_dismissed', '1')
    localStorage.setItem('tolaria:ai-agents-onboarding-dismissed', '1')
    localStorage.setItem('tolaria:claude-code-onboarding-dismissed', '1')

    const startupWindow = window as StartupWindow
    const noteContent = {
      [noteEntry.path]: '# Recovered Startup Note\n\nRecovered content.',
    }
    let reloadCount = 0

    function emptyArray(): unknown[] {
      return []
    }

    function commandPath(args: CommandArgs): string {
      return typeof args?.path === 'string' ? args.path : ''
    }

    const handlers: HandlerMap = {
      load_vault_list: () => ({
        vaults: [
          { label: 'Recovered Vault', path: vaultPath },
          { label: 'Secondary Vault', path: `${vaultPath}-secondary` },
        ],
        active_vault: vaultPath,
        default_workspace_path: vaultPath,
        hidden_defaults: [],
      }),
      check_vault_exists: () => true,
      get_default_vault_path: () => defaultPath,
      get_settings: () => ({
        auto_pull_interval_minutes: null,
        autogit_enabled: false,
        autogit_idle_threshold_seconds: 90,
        autogit_inactive_threshold_seconds: 30,
        auto_advance_inbox_after_organize: null,
        telemetry_consent: true,
        crash_reporting_enabled: null,
        analytics_enabled: null,
        anonymous_id: null,
        release_channel: null,
        theme_mode: null,
        ui_language: null,
        note_width_mode: null,
        sidebar_type_pluralization_enabled: null,
        default_ai_agent: null,
        default_ai_target: null,
        ai_model_providers: [],
      }),
      get_vault_settings: () => ({ theme: null }),
      reload_vault: (args) => {
        if (commandPath(args) !== vaultPath) return emptyArray()
        reloadCount += 1
        return reloadCount === 1 ? emptyArray() : [noteEntry]
      },
      list_vault: emptyArray,
      list_vault_folders: emptyArray,
      list_views: emptyArray,
      get_modified_files: emptyArray,
      get_all_content: () => noteContent,
      get_note_content: (args) => noteContent[commandPath(args) as keyof typeof noteContent] ?? '',
      is_git_repo: () => true,
      sync_mcp_bridge_vault: () => null,
      start_vault_watcher: () => null,
      stop_vault_watcher: () => null,
      update_menu_state: () => null,
    }

    startupWindow.__startupReloadCount = () => reloadCount
    startupWindow.__TAURI_INTERNALS__ = {
      transformCallback: () => crypto.randomUUID(),
      unregisterCallback: () => {},
      invoke: async (command, args) => {
        if (command === 'plugin:event|listen') return 1
        if (command === 'plugin:event|unlisten') return null
        return handlers[command]?.(args) ?? startupWindow.__mockHandlers?.[command]?.(args) ?? null
      },
    }
    startupWindow.isTauri = true
  }, { defaultPath: starterVaultPath, vaultPath: activeVaultPath, noteEntry: recoveredEntry })
}

async function startupReloadCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as StartupWindow).__startupReloadCount?.() ?? 0)
}

test('startup recovers notes after an empty first vault reload @smoke', async ({ page }) => {
  await installStartupRecoveryMock(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Recovered Startup Note')).toBeVisible({ timeout: 8_000 })
  await expect.poll(() => startupReloadCount(page)).toBeGreaterThanOrEqual(2)
})
