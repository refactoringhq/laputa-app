import { test, expect, type Page } from '@playwright/test'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { RUNTIME_STYLE_NONCE } from '../../src/lib/runtimeStyleNonce'
import {
  dispatchShortcutEvent,
  triggerMenuCommand,
  triggerShortcutCommand,
} from './testBridge'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

let tempVaultDir: string

const GLOBAL_SEARCH_INPUT = 'input[placeholder="Search in all notes..."]'
const GLOBAL_SEARCH_RESULTS = [
  { title: 'First Search Result', path: '/vault/first-search-result.md', snippet: 'first', score: 1, note_type: null },
  { title: 'Second Search Result', path: '/vault/second-search-result.md', snippet: 'second', score: 0.9, note_type: null },
  { title: 'Third Search Result', path: '/vault/third-search-result.md', snippet: 'third', score: 0.8, note_type: null },
]

async function openAlphaProjectInEditor(page: Page) {
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
  await page.getByText('Alpha Project', { exact: true }).first().click()
  await page.locator('.bn-editor').click()
}

function collectRuntimeStyleCspSignals(page: Page): string[] {
  const messages: string[] = []

  page.on('pageerror', (error) => {
    messages.push(error.message)
  })

  page.on('console', (message) => {
    const text = message.text()
    if (
      /Content Security Policy|Refused to apply a stylesheet|Failed to insert placeholder CSS rule|style-src|insertRule/i
        .test(text)
    ) {
      messages.push(text)
    }
  })

  return messages
}

async function expectRuntimeStyleNonce(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate((nonce) => {
    const styles = Array.from(document.querySelectorAll('style')) as HTMLStyleElement[]
    return styles.some((style) => style.nonce === nonce)
  }, RUNTIME_STYLE_NONCE), { timeout: 5_000 }).toBe(true)
}

async function expectPropertiesPanelToggle(page: Page, toggle: () => Promise<void>) {
  const propertiesButton = page.getByRole('button', { name: 'Open the properties panel' })
  await expect(propertiesButton).toBeVisible({ timeout: 5_000 })

  await toggle()
  await expect(propertiesButton).toHaveCount(0)

  await toggle()
  await expect(page.getByRole('button', { name: 'Open the properties panel' })).toBeVisible({ timeout: 5_000 })
}

async function dispatchAppCommand(page: Page, id: string): Promise<void> {
  await page.evaluate((commandId) => {
    const bridge = window.__laputaTest?.dispatchAppCommand
    if (typeof bridge !== 'function') {
      throw new Error('Tolaria test bridge is missing dispatchAppCommand')
    }
    bridge(commandId)
  }, id)
}

async function installGlobalSearchResultsHarness(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__mockHandlers?.search_vault))
  await page.evaluate((results) => {
    type Handler = (args?: Record<string, unknown>) => unknown
    const handlers = window.__mockHandlers as Record<string, Handler>
    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      get: () => handlers,
      set: (nextHandlers) => Object.assign(handlers, nextHandlers),
    })
    handlers.search_vault = () => ({ results, elapsed_ms: 1 })
  }, GLOBAL_SEARCH_RESULTS)
}

function searchResultRow(page: Page, title: string) {
  return page.locator('[role="option"]').filter({ hasText: title }).first()
}

async function expectSelectedSearchResult(page: Page, title: string): Promise<void> {
  await expect(searchResultRow(page, title)).toHaveClass(/bg-accent/)
}

test.describe('keyboard command routing', () => {
  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('desktop menu-command bridge creates a note through the shared command path @smoke', async ({ page }) => {
    const runtimeStyleCspSignals = collectRuntimeStyleCspSignals(page)

    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await triggerMenuCommand(page, APP_COMMAND_IDS.fileNewNote)

    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+/i, { timeout: 5_000 })
    await expectRuntimeStyleNonce(page)
    expect(runtimeStyleCspSignals).toEqual([])
  })

  test('desktop menu-command bridge toggles the properties panel through the shared command path @smoke', async ({ page }) => {
    await openAlphaProjectInEditor(page)
    await expectPropertiesPanelToggle(page, async () => {
      await triggerMenuCommand(page, APP_COMMAND_IDS.viewToggleProperties)
    })
  })

  test('desktop keyboard shortcut toggles the properties panel through the renderer shortcut path @smoke', async ({ page }) => {
    await openAlphaProjectInEditor(page)
    await expectPropertiesPanelToggle(page, async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+I' : 'Control+Shift+I')
    })
  })

  test('desktop shortcut bridge opens quick open through both Cmd+P and Cmd+O @smoke', async ({ page }) => {
    await openFixtureVaultDesktopHarness(page, tempVaultDir)

    await dispatchShortcutEvent(page, {
      key: 'p',
      code: 'KeyP',
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
      bubbles: true,
      cancelable: true,
    })
    await expect(page.getByTestId('quick-open-palette')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('input[placeholder="Search notes..."]')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('quick-open-palette')).not.toBeVisible({ timeout: 5_000 })

    await dispatchShortcutEvent(page, {
      key: 'o',
      code: 'KeyO',
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
      bubbles: true,
      cancelable: true,
    })
    await expect(page.getByTestId('quick-open-palette')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('input[placeholder="Search notes..."]')).toBeFocused()
  })

  test('global search arrow keys move one result at a time @smoke', async ({ page }) => {
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await installGlobalSearchResultsHarness(page)

    await page.locator('body').click()
    await dispatchShortcutEvent(page, {
      key: 'f',
      code: 'KeyF',
      ctrlKey: false,
      metaKey: true,
      shiftKey: true,
      altKey: false,
      bubbles: true,
      cancelable: true,
    })
    const input = page.locator(GLOBAL_SEARCH_INPUT)
    await expect(input).toBeVisible({ timeout: 5_000 })
    await input.fill('search')
    await expect(searchResultRow(page, 'Third Search Result')).toBeVisible({ timeout: 5_000 })

    await expectSelectedSearchResult(page, 'First Search Result')
    await page.keyboard.press('ArrowDown')
    await expectSelectedSearchResult(page, 'Second Search Result')
    await page.keyboard.press('ArrowDown')
    await expectSelectedSearchResult(page, 'Third Search Result')
    await page.keyboard.press('ArrowUp')
    await expectSelectedSearchResult(page, 'Second Search Result')
  })

  test('desktop menu-command bridge toggles organized state through the shared command path @smoke', async ({ page }) => {
    await openAlphaProjectInEditor(page)

    await expect(page.getByRole('button', { name: 'Set note as organized' })).toBeVisible({ timeout: 5_000 })

    await triggerMenuCommand(page, APP_COMMAND_IDS.noteToggleOrganized)
    await expect(page.getByRole('button', { name: 'Set note as not organized' })).toBeVisible({ timeout: 5_000 })

    await triggerMenuCommand(page, APP_COMMAND_IDS.noteToggleOrganized)
    await expect(page.getByRole('button', { name: 'Set note as organized' })).toBeVisible({ timeout: 5_000 })
  })

  test('app command bridge undoes and redoes organized state through action history @smoke', async ({ page }) => {
    await openAlphaProjectInEditor(page)

    await triggerMenuCommand(page, APP_COMMAND_IDS.noteToggleOrganized)
    await expect(page.getByRole('button', { name: 'Set note as not organized' })).toBeVisible({ timeout: 5_000 })

    await dispatchAppCommand(page, APP_COMMAND_IDS.editUndo)
    await expect(page.getByRole('button', { name: 'Set note as organized' })).toBeVisible({ timeout: 5_000 })

    await dispatchAppCommand(page, APP_COMMAND_IDS.editRedo)
    await expect(page.getByRole('button', { name: 'Set note as not organized' })).toBeVisible({ timeout: 5_000 })
  })

  test('renderer shortcut bridge toggles the raw editor through the shared keyboard handler @smoke', async ({ page }) => {
    const runtimeStyleCspSignals = collectRuntimeStyleCspSignals(page)

    await openAlphaProjectInEditor(page)

    await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
    await expect(page.getByTestId('raw-editor-codemirror')).toBeVisible({ timeout: 5_000 })
    await expectRuntimeStyleNonce(page)

    await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
    await expect(page.getByTestId('raw-editor-codemirror')).not.toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
    expect(runtimeStyleCspSignals).toEqual([])
  })

  test('desktop menu-command bridge toggles the AI panel, while the wrong modifier event does not @smoke', async ({ page }) => {
    await openAlphaProjectInEditor(page)

    await dispatchShortcutEvent(page, {
      key: 'l',
      code: 'KeyL',
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    await page.waitForTimeout(200)
    await expect(page.getByTestId('ai-panel')).not.toBeVisible()

    await triggerMenuCommand(page, APP_COMMAND_IDS.viewToggleAiChat)
    await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTitle('Close AI workspace')).toBeVisible()

    await triggerMenuCommand(page, APP_COMMAND_IDS.viewToggleAiChat)
    await expect(page.getByTestId('ai-panel')).not.toBeVisible({ timeout: 5_000 })
  })
})
