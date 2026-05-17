import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

const RTL_TITLE = 'RTL Mixed Direction'
const RTL_PARAGRAPH = 'مرحبا بالعالم'
const MIXED_PARAGRAPH = 'English then مرحبا'
const RTL_LIST_ITEM = 'רשימת בדיקה'
const RTL_QUOTE = 'ציטוט חשוב'
const RTL_TABLE_CELL = 'תא בטבלה'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  fs.writeFileSync(
    path.join(tempVaultDir, 'note', 'rtl-mixed-direction.md'),
    [
      '---',
      'Is A: Note',
      '---',
      '',
      `# ${RTL_TITLE}`,
      '',
      RTL_PARAGRAPH,
      '',
      MIXED_PARAGRAPH,
      '',
      `- ${RTL_LIST_ITEM}`,
      '',
      `> ${RTL_QUOTE}`,
      '',
      '| Field | Value |',
      '| --- | --- |',
      `| ${RTL_TABLE_CELL} | 42 |`,
      '',
    ].join('\n'),
  )
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string) {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function openRawMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 })
}

test('rich and raw editors resolve text direction per line for Arabic and mixed content', async ({ page }) => {
  await openNote(page, RTL_TITLE)

  const rtlRichBlock = page.locator('.bn-inline-content', { hasText: RTL_PARAGRAPH }).first()
  await expect(rtlRichBlock).toBeVisible({ timeout: 5_000 })
  await expect(rtlRichBlock).toHaveCSS('unicode-bidi', 'plaintext')
  await expect(rtlRichBlock).toHaveCSS('text-align', 'start')

  await openRawMode(page)

  const rawLines = page.locator('.cm-line')
  await expect(rawLines.filter({ hasText: RTL_PARAGRAPH })).toHaveAttribute('dir', 'auto')
  await expect(rawLines.filter({ hasText: MIXED_PARAGRAPH })).toHaveAttribute('dir', 'auto')
  await expect(rawLines.filter({ hasText: RTL_PARAGRAPH })).toHaveCSS('unicode-bidi', 'plaintext')
  await expect(rawLines.filter({ hasText: RTL_PARAGRAPH })).toHaveCSS('text-align', 'start')
})

test('rich editor uses logical spacing for RTL block elements', async ({ page }) => {
  await openNote(page, RTL_TITLE)

  const rtlListItem = page.locator('[data-content-type="bulletListItem"]', { hasText: RTL_LIST_ITEM }).first()
  await expect(rtlListItem).toBeVisible({ timeout: 5_000 })
  await expect(rtlListItem).toHaveAttribute('dir', 'auto')
  await expect(rtlListItem).toHaveCSS('direction', 'rtl')
  await expect.poll(async () => rtlListItem.evaluate((element) => {
    const style = getComputedStyle(element)
    return Number.parseFloat(style.paddingRight) > Number.parseFloat(style.paddingLeft)
  })).toBe(true)

  const rtlQuote = page.locator('.bn-block-content', { hasText: RTL_QUOTE }).first()
  await expect(rtlQuote).toBeVisible({ timeout: 5_000 })
  await expect(rtlQuote).toHaveAttribute('dir', 'auto')
  await expect(rtlQuote).toHaveCSS('direction', 'rtl')
  const rtlQuoteElement = page.locator('blockquote', { hasText: RTL_QUOTE }).first()
  await expect(rtlQuoteElement).toBeVisible({ timeout: 5_000 })
  await expect.poll(async () => rtlQuoteElement.evaluate((element) => {
    const style = getComputedStyle(element)
    return Number.parseFloat(style.borderRightWidth) > Number.parseFloat(style.borderLeftWidth)
  })).toBe(true)

  const rtlTableCell = page.locator('td', { hasText: RTL_TABLE_CELL }).first()
  await expect(rtlTableCell).toBeVisible({ timeout: 5_000 })
  await expect(rtlTableCell).toHaveCSS('text-align', 'start')
})
