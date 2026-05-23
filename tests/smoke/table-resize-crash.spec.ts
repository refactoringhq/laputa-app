import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { seedBlockNoteTable, triggerMenuCommand } from './testBridge'

let tempVaultDir: string

function trackUnexpectedErrors(page: Page): string[] {
  const errors: string[] = []

  page.on('pageerror', (error) => {
    errors.push(error.message)
  })

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('ws://localhost:9711')) return
    if (text.includes('Failed to load resource: the server responded with a status of 400')) return
    errors.push(text)
  })

  return errors
}

async function createUntitledNote(page: Page): Promise<void> {
  await triggerMenuCommand(page, 'file-new-note')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function seedResizedTable(page: Page): Promise<void> {
  await seedBlockNoteTable(page, [180, 120, 120])
}

async function toggleRawEditorRoundTrip(page: Page): Promise<void> {
  await triggerMenuCommand(page, 'edit-toggle-raw-editor')
  await expect(page.getByTestId('raw-editor-codemirror')).toBeVisible({ timeout: 5_000 })
  await expect(page.locator('.cm-content')).toContainText('| Head 1 | Head 2 | Head 3 |')

  await triggerMenuCommand(page, 'edit-toggle-raw-editor')
  await expect(page.getByTestId('raw-editor-codemirror')).not.toBeVisible({ timeout: 5_000 })
  await expect(page.locator('table')).toHaveCount(1, { timeout: 5_000 })
}

test.describe('table resize crash fix', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page
    testInfo.setTimeout(60_000)
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('switching to raw mode and back after a seeded resized table does not lose the table', async ({ page }) => {
    const errors = trackUnexpectedErrors(page)

    await openFixtureVaultTauri(page, tempVaultDir)
    await createUntitledNote(page)
    await seedResizedTable(page)

    await toggleRawEditorRoundTrip(page)

    expect(errors).toEqual([])
  })

  test('clicking a seeded table before the raw-mode roundtrip does not crash', async ({ page }) => {
    const errors = trackUnexpectedErrors(page)

    await openFixtureVaultTauri(page, tempVaultDir)
    await createUntitledNote(page)
    await seedResizedTable(page)
    await page.locator('table td').first().click()

    await toggleRawEditorRoundTrip(page)

    expect(errors).toEqual([])
  })
})
