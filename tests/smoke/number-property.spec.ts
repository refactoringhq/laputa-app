import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { triggerShortcutCommand } from './testBridge'

let tempVaultDir: string

function alphaProjectPath(vaultPath: string): string {
  return path.join(vaultPath, 'project', 'alpha-project.md')
}

async function setAppZoom(page: Page, percent: number): Promise<void> {
  await page.evaluate((level) => {
    document.documentElement.style.setProperty('zoom', `${level}%`)
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-factor', String(level / 100))
    document.documentElement.style.setProperty('--tolaria-overlay-zoom-inverse', String(100 / level))
    window.dispatchEvent(new Event('laputa-zoom-change'))
  }, percent)
}

test.describe('Number property editing', () => {
  test.describe.configure({ timeout: 45_000 })

  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await page.setViewportSize({ width: 1600, height: 900 })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('properties panel saves number values across raw-mode switches and note reloads @smoke', async ({ page }) => {
    const notePath = alphaProjectPath(tempVaultDir)
    const noteList = page.getByTestId('note-list-container')

    await noteList.getByText('Alpha Project', { exact: true }).click()
    await triggerShortcutCommand(page, APP_COMMAND_IDS.viewToggleProperties)
    await expect(page.getByTestId('add-property-row')).toBeVisible()

    await page.getByTestId('add-property-row').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('add-property-form')).toBeVisible()

    await page.keyboard.type('Estimate')
    await setAppZoom(page, 130)
    await page.getByTestId('add-property-type-trigger').click()
    const numberOption = page.getByRole('option', { name: 'Number', exact: true })
    await expect(numberOption).toBeVisible()
    await expect(numberOption).toBeInViewport()
    await numberOption.click()
    const numberInput = page.getByTestId('add-property-number-input')
    await expect(numberInput).toBeVisible()
    await numberInput.focus()
    await page.keyboard.type(' -12.5 ')
    await page.keyboard.press('Enter')

    await expect.poll(() => fs.readFileSync(notePath, 'utf8')).toContain('Estimate: -12.5')
    await expect(page.getByTestId('number-display')).toContainText('-12.5')

    await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
    const rawEditor = page.locator('.cm-content')
    await expect(rawEditor).toBeVisible()
    await expect(rawEditor).toContainText('Estimate: -12.5')
    await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)

    await page.reload({ waitUntil: 'networkidle' })
    await noteList.getByText('Alpha Project', { exact: true }).click()
    await triggerShortcutCommand(page, APP_COMMAND_IDS.viewToggleProperties)
    await expect(page.getByTestId('number-display')).toContainText('-12.5')
  })
})
