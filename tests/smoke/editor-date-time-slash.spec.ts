import { expect, test } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { triggerShortcutCommand } from './testBridge'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('date and time slash commands insert resolved plain Markdown text', async ({ page }) => {
  await page.locator('[data-testid="note-list-container"]').getByText('Note B', {
    exact: true,
  }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })

  await page.locator('.bn-block-content').last().click()
  await page.keyboard.press('Enter')

  for (const command of ['date', 'time', 'datetime']) {
    await page.keyboard.type(`/${command}`)
    await page.getByRole('option', {
      exact: true,
      name: command === 'datetime' ? 'Date and time' : command[0].toUpperCase() + command.slice(1),
    }).click()
    if (command !== 'datetime') await page.keyboard.type(' ')
  }

  const insertedText = await page.locator('.bn-block-content').filter({
    hasText: /^\d{4}-\d{2}-\d{2}/,
  }).last().innerText()
  expect(insertedText).toMatch(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
  )

  await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
  await expect(page.locator('.cm-content')).toContainText(insertedText)
})
