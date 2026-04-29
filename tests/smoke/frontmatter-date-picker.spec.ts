import { test, expect, type Locator, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { triggerShortcutCommand } from './testBridge'

test.use({ timezoneId: 'Europe/Rome' })

let tempVaultDir: string

function alphaProjectPath(vaultPath: string): string {
  return path.join(vaultPath, 'project', 'alpha-project.md')
}

function seedDateProperty(notePath: string, value: string): void {
  const content = fs.readFileSync(notePath, 'utf8')
  fs.writeFileSync(notePath, content.replace('Status: Active\n', `Status: Active\nDate: ${value}\n`))
}

async function calendarDay(page: Page, year: number, monthIndex: number, day: number): Promise<Locator> {
  const dateLabel = await page.evaluate(
    ({ y, m, d }) => new Date(y, m, d).toLocaleDateString(),
    { y: year, m: monthIndex, d: day },
  )
  return page.locator(`button[data-day="${dateLabel}"]`).first()
}

test.describe('Frontmatter date picker', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    seedDateProperty(alphaProjectPath(tempVaultDir), '2026-04-29T00:00:00')
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await page.setViewportSize({ width: 1600, height: 900 })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('local-midnight date properties keep the selected calendar day @smoke', async ({ page }) => {
    const notePath = alphaProjectPath(tempVaultDir)

    await page.getByTestId('note-list-container').getByText('Alpha Project', { exact: true }).click()
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
    await triggerShortcutCommand(page, APP_COMMAND_IDS.viewToggleProperties)
    await expect(page.getByTestId('add-property-row')).toBeVisible()

    const dateRow = page.getByTestId('editable-property').filter({ hasText: 'Date' })
    await dateRow.getByTestId('date-display').click()

    await expect(await calendarDay(page, 2026, 3, 29)).toHaveAttribute('data-selected-single', 'true')
    await (await calendarDay(page, 2026, 3, 30)).click()

    await expect.poll(() => fs.readFileSync(notePath, 'utf8')).toMatch(/Date: "?2026-04-30"?/)
  })
})
