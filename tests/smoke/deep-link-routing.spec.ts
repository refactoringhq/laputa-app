import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette, sendShortcut } from './helpers'
import { openDeepLink } from './testBridge'

let tempVaultDir: string

test.beforeEach(() => {
  tempVaultDir = createFixtureVaultCopy()
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function installClipboardCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          ;(window as Window & { __tolariaCopiedText?: string }).__tolariaCopiedText = text
        },
      },
    })
  })
}

async function copiedText(page: Page): Promise<string> {
  return page.evaluate(() => (window as Window & { __tolariaCopiedText?: string }).__tolariaCopiedText ?? '')
}

async function openNoteWithQuickOpen(page: Page, title: string, expectedFilename: string): Promise<void> {
  await sendShortcut(page, 'p', ['Control'])
  await expect(page.getByTestId('quick-open-palette')).toBeVisible({ timeout: 5_000 })
  await page.locator('input[placeholder="Search notes..."]').fill(title)
  await expect(page.getByTestId('quick-open-palette').getByText(title, { exact: true })).toBeVisible({ timeout: 5_000 })
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(expectedFilename, { timeout: 5_000 })
}

test('command palette copies and opens a Tolaria item deep link', async ({ page }) => {
  await installClipboardCapture(page)
  await openFixtureVaultDesktopHarness(page, tempVaultDir)

  await openNoteWithQuickOpen(page, 'Alpha Project', 'alpha-project')
  await openCommandPalette(page)
  await executeCommand(page, 'Copy deep link to current item')

  const deepLink = await copiedText(page)
  expect(deepLink).toBe('tolaria://test-vault/project/alpha-project.md')

  await openNoteWithQuickOpen(page, 'Note B', 'note-b')
  await openDeepLink(page, deepLink)
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('alpha-project', { timeout: 5_000 })

  await openDeepLink(page, 'tolaria://missing-vault/project/alpha-project.md')
  await expect(page.getByText('Deep link targets an unknown vault.')).toBeVisible({ timeout: 5_000 })
})
