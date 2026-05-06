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

async function chooseCalendarOption(page: Page, calendar: Locator, index: number, optionName: string): Promise<void> {
  const trigger = calendar.getByRole('combobox').nth(index)
  await expect(trigger).toBeVisible()
  await trigger.click()
  const option = page.getByRole('option', { name: optionName, exact: true })
  await expect(option).toBeVisible()
  await option.click()
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
    await expect(page.getByRole('heading', { name: 'Alpha Project', level: 1 })).toBeVisible({ timeout: 5_000 })
    await triggerShortcutCommand(page, APP_COMMAND_IDS.viewToggleProperties)
    await expect(page.getByTestId('add-property-row')).toBeVisible()

    const dateRow = page.getByTestId('editable-property').filter({ hasText: 'Date' })
    await dateRow.getByTestId('date-display').click()

    await expect(page.getByTestId('date-picker-input')).toHaveValue('2026-04-29')
    const triggerBox = await dateRow.getByTestId('date-display').boundingBox()
    const popoverBox = await page.getByTestId('date-picker-popover').boundingBox()
    const rowBox = await dateRow.boundingBox()
    expect(popoverBox?.y).toBeGreaterThanOrEqual((rowBox?.y ?? 0) + (rowBox?.height ?? 0) - 1)
    expect((popoverBox?.x ?? 0) + (popoverBox?.width ?? 0)).toBeLessThanOrEqual((triggerBox?.x ?? 0) + (triggerBox?.width ?? 0) + 2)

    await expect(await calendarDay(page, 2026, 3, 29)).toHaveAttribute('data-selected-single', 'true')
    await (await calendarDay(page, 2026, 3, 30)).click()

    await expect.poll(() => fs.readFileSync(notePath, 'utf8')).toMatch(/Date: "?2026-04-30"?/)
  })

  test('month and year controls change the visible calendar page', async ({ page }) => {
    const notePath = alphaProjectPath(tempVaultDir)

    await page.getByTestId('note-list-container').getByText('Alpha Project', { exact: true }).click()
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('heading', { name: 'Alpha Project', level: 1 })).toBeVisible({ timeout: 5_000 })
    await triggerShortcutCommand(page, APP_COMMAND_IDS.viewToggleProperties)

    const dateRow = page.getByTestId('editable-property').filter({ hasText: 'Date' })
    await dateRow.getByTestId('date-display').click()

    const calendar = page.getByTestId('date-picker-calendar')
    await expect(calendar).toBeVisible()
    await chooseCalendarOption(page, calendar, 0, 'May')
    const lastWeekDayBox = await (await calendarDay(page, 2026, 4, 31)).boundingBox()
    const clearButtonBox = await page.getByTestId('date-picker-clear').boundingBox()
    expect(clearButtonBox?.y).toBeGreaterThanOrEqual((lastWeekDayBox?.y ?? 0) + (lastWeekDayBox?.height ?? 0) - 1)
    await chooseCalendarOption(page, calendar, 1, '2027')
    await (await calendarDay(page, 2027, 4, 13)).click()

    await expect.poll(() => fs.readFileSync(notePath, 'utf8')).toMatch(/Date: "?2027-05-13"?/)
  })

  test('manual date input updates the date property', async ({ page }) => {
    const notePath = alphaProjectPath(tempVaultDir)

    await page.getByTestId('note-list-container').getByText('Alpha Project', { exact: true }).click()
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('heading', { name: 'Alpha Project', level: 1 })).toBeVisible({ timeout: 5_000 })
    await triggerShortcutCommand(page, APP_COMMAND_IDS.viewToggleProperties)

    const dateRow = page.getByTestId('editable-property').filter({ hasText: 'Date' })
    await dateRow.getByTestId('date-display').click()

    const input = page.getByTestId('date-picker-input')
    await input.fill('2026-05-13')
    await input.press('Enter')

    await expect.poll(() => fs.readFileSync(notePath, 'utf8')).toMatch(/Date: "?2026-05-13"?/)
  })
})
