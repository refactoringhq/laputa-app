import { expect, test, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

let tempVaultDir: string

async function openPropertiesPanel(page: Page): Promise<void> {
  const openPanelButton = page.getByRole('button', { name: 'Open the properties panel' })
  if (await openPanelButton.count()) await openPanelButton.click()
}

async function openNoteFromList(page: Page, title: string): Promise<void> {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke the first type change keeps a newly titled note active and persists', async ({ page }) => {
  const title = `First Property ${Date.now()}`

  await triggerMenuCommand(page, 'file-new-note')
  const titleBlock = page.locator('.bn-block-content[data-content-type="heading"]').first()
  await expect(titleBlock).toBeVisible({ timeout: 5_000 })
  await titleBlock.click()
  await page.keyboard.type(title)

  await openPropertiesPanel(page)
  const typeSelector = page.getByTestId('type-selector')
  await typeSelector.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Project', exact: true }).click()

  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await expect(typeSelector.getByRole('combobox')).toContainText('Project')
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('first-property-', {
    timeout: 10_000,
  })

  await openNoteFromList(page, 'Alpha Project')
  await openNoteFromList(page, title)
  await expect(page.getByTestId('type-selector').getByRole('combobox')).toContainText('Project')
})
