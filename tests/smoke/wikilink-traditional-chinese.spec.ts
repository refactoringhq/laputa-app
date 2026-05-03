import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  fs.writeFileSync(
    path.join(tempVaultDir, '測試.md'),
    '---\ntype: Note\n---\n# 測試\n\nTraditional Chinese wikilink target.\n',
  )
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string) {
  const noteList = page.locator('[data-testid="note-list-container"]')
  await noteList.getByText(title, { exact: true }).click()
}

async function appendWikilinkQuery(page: Page, query: string) {
  const lastBlock = page.locator('.bn-block-content').last()
  await expect(lastBlock).toBeVisible({ timeout: 5_000 })
  await lastBlock.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(query)
}

test('Traditional Chinese note titles can be inserted and followed as wikilinks', async ({ page }) => {
  await expect(page.locator('[data-testid="note-list-container"]').getByText('測試', { exact: true }))
    .toBeVisible({ timeout: 5_000 })

  await openNote(page, 'Alpha Project')
  await appendWikilinkQuery(page, '[[測試')

  const suggestionMenu = page.locator('.wikilink-menu')
  await expect(suggestionMenu).toBeVisible({ timeout: 5_000 })
  await expect(suggestionMenu.getByText('測試', { exact: true })).toBeVisible()
  await page.keyboard.press('Enter')

  const insertedLink = page.locator('.bn-editor .wikilink').filter({ hasText: '測試' }).last()
  await expect(insertedLink).toBeVisible({ timeout: 5_000 })
  await expect(insertedLink).not.toHaveClass(/wikilink--broken/)

  await insertedLink.click({ modifiers: ['Meta'] })
  await expect(page.getByRole('heading', { name: '測試', level: 1 })).toBeVisible({ timeout: 5_000 })
})
