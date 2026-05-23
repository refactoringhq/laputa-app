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

async function pasteTextIntoCell(page: Page, cellIndex: number, text: string): Promise<void> {
  await page.locator('table td').nth(cellIndex).click()
  await page.evaluate(async (value) => {
    await navigator.clipboard.writeText(value)
  }, text)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
}

test.describe('table cell paste regression', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page
    testInfo.setTimeout(60_000)
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('pasting plain and multiline text into table cells keeps note editing usable', async ({ page, context }) => {
    const errors = trackUnexpectedErrors(page)

    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openFixtureVaultTauri(page, tempVaultDir)
    await createUntitledNote(page)
    await seedBlockNoteTable(page, [180, 120, 120])

    await expect(page.locator('table')).toHaveCount(1, { timeout: 5_000 })

    await pasteTextIntoCell(page, 0, 'plain pasted cell')
    await triggerMenuCommand(page, 'file-save')
    await pasteTextIntoCell(page, 1, 'line one\nline two')

    const trailingParagraph = page.locator('.bn-editor [data-content-type="paragraph"]').last()
    await trailingParagraph.click()
    await page.keyboard.type('still editable after table paste')

    const editor = page.getByRole('textbox').last()
    await expect(editor).toContainText('plain pasted cell')
    await expect(editor).toContainText('line one')
    await expect(editor).toContainText('still editable after table paste')
    await expect(page.locator('table')).toHaveCount(1)
    expect(errors).toEqual([])
  })
})
