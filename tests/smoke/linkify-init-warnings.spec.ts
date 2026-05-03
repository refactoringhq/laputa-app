import { test, expect } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { sendShortcut } from './helpers'

let tempVaultDir: string

function collectLinkifyWarnings(page: import('@playwright/test').Page) {
  const warnings: string[] = []

  page.on('console', (message) => {
    const text = message.text()
    if (/linkifyjs: already initialized - will not register custom scheme/i.test(text)) {
      const location = message.location()
      const locationLabel = [
        location.url || 'unknown-url',
        location.lineNumber ?? 'unknown-line',
        location.columnNumber ?? 'unknown-column',
      ].join(':')
      warnings.push(`${locationLabel} ${text}`)
    }
  })

  return warnings
}

async function openNote(page: import('@playwright/test').Page, title: string) {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 5_000 })
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke note open and editor remount flows stay free of duplicate linkify warnings', async ({ page }) => {
  const linkifyWarnings = collectLinkifyWarnings(page)

  await openNote(page, 'Alpha Project')
  await openNote(page, 'Note B')

  await sendShortcut(page, 'Backslash', ['Control'])
  await expect(page.getByTestId('raw-editor-codemirror')).toBeVisible({ timeout: 5_000 })

  await sendShortcut(page, 'Backslash', ['Control'])
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })

  await openNote(page, 'Alpha Project')
  await page.waitForTimeout(300)

  expect(linkifyWarnings).toEqual([])
})
