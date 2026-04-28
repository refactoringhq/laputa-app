import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette, sendShortcut } from './helpers'

const IGNORED_DIR = 'ignored-local'
const IGNORED_TITLE = 'Ignored Local Note'
const IGNORED_NEEDLE = 'gitignored-visibility-needle'
const QUICK_OPEN_INPUT = 'input[placeholder="Search notes..."]'
const GLOBAL_SEARCH_INPUT = 'input[placeholder="Search in all notes..."]'

let tempVaultDir: string

function writeIgnoredFixture(vaultPath: string): void {
  fs.writeFileSync(path.join(vaultPath, '.gitignore'), `${IGNORED_DIR}/\n`)
  fs.mkdirSync(path.join(vaultPath, IGNORED_DIR), { recursive: true })
  fs.writeFileSync(
    path.join(vaultPath, IGNORED_DIR, 'ignored-local-note.md'),
    `---\ntype: Note\n---\n# ${IGNORED_TITLE}\n\n${IGNORED_NEEDLE}\n`,
  )
}

async function installGitignoredVisibilityHarness(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__mockHandlers?.list_vault))
  await page.evaluate(({ ignoredDir }) => {
    type Handler = (args?: Record<string, unknown>) => unknown
    type SearchResponse = { results: Array<{ path: string }>; elapsed_ms: number }
    type Settings = Record<string, unknown> & { hide_gitignored_files?: boolean | null }

    const handlers = window.__mockHandlers as Record<string, Handler>
    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      get: () => handlers,
      set: (nextHandlers) => Object.assign(handlers, nextHandlers),
    })
    const originalGetSettings = handlers.get_settings?.bind(handlers)
    const originalList = handlers.list_vault.bind(handlers)
    const originalReload = handlers.reload_vault.bind(handlers)
    const originalSearch = handlers.search_vault.bind(handlers)
    let settings: Settings = {
      ...((originalGetSettings?.() as Settings | undefined) ?? {}),
      hide_gitignored_files: null,
    }

    const ignoredPathFragment = `/${ignoredDir}/`
    const isIgnoredPath = (candidate: string) =>
      candidate.includes(ignoredPathFragment) || candidate.includes(`\\${ignoredDir}\\`)
    const shouldShowPath = (candidate: string) =>
      settings.hide_gitignored_files === false || !isIgnoredPath(candidate)
    const filterEntries = (entries: Array<{ path: string }>) =>
      entries.filter((entry) => shouldShowPath(entry.path))

    handlers.get_settings = () => settings
    handlers.save_settings = (args?: Record<string, unknown>) => {
      settings = { ...settings, ...((args?.settings as Settings | undefined) ?? {}) }
      return null
    }
    handlers.list_vault = async (args?: Record<string, unknown>) =>
      filterEntries(await originalList(args) as Array<{ path: string }>)
    handlers.reload_vault = async (args?: Record<string, unknown>) =>
      filterEntries(await originalReload(args) as Array<{ path: string }>)
    handlers.search_vault = async (args?: Record<string, unknown>) => {
      const response = await originalSearch(args) as SearchResponse
      return {
        ...response,
        results: response.results.filter((result) => shouldShowPath(result.path)),
      }
    }
  }, { ignoredDir: IGNORED_DIR })
}

async function reloadVaultFromCommandPalette(page: Page): Promise<void> {
  await openCommandPalette(page)
  await executeCommand(page, 'Reload Vault')
  await expect(page.locator('input[placeholder="Type a command..."]')).not.toBeVisible()
}

async function openQuickOpen(page: Page): Promise<void> {
  await page.locator('body').click()
  await sendShortcut(page, 'p', ['Control'])
  await expect(page.locator(QUICK_OPEN_INPUT)).toBeVisible()
}

async function expectQuickOpenResult(page: Page, visible: boolean): Promise<void> {
  await openQuickOpen(page)
  await page.locator(QUICK_OPEN_INPUT).fill(IGNORED_TITLE)
  const result = page.getByTestId('quick-open-palette').getByText(IGNORED_TITLE, { exact: true })
  await expect(result).toHaveCount(visible ? 1 : 0, { timeout: 5_000 })
  await page.keyboard.press('Escape')
}

async function expectGlobalSearchResult(page: Page, visible: boolean): Promise<void> {
  await page.locator('body').click()
  await sendShortcut(page, 'f', ['Control', 'Shift'])
  await expect(page.locator(GLOBAL_SEARCH_INPUT)).toBeVisible()
  await page.locator(GLOBAL_SEARCH_INPUT).fill(IGNORED_NEEDLE)
  const result = page.getByText(IGNORED_TITLE, { exact: true })
  await expect(result).toHaveCount(visible ? 1 : 0, { timeout: 5_000 })
  await page.keyboard.press('Escape')
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  writeIgnoredFixture(tempVaultDir)
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
  await installGitignoredVisibilityHarness(page)
  await reloadVaultFromCommandPalette(page)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('Gitignored vault content hides by default and reappears from the command palette', async ({ page }) => {
  await expectQuickOpenResult(page, false)
  await expectGlobalSearchResult(page, false)

  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Gitignored Files Visibility')
  await expect(page.locator('input[placeholder="Type a command..."]')).not.toBeVisible()

  await expectQuickOpenResult(page, true)
  await expectGlobalSearchResult(page, true)
})
