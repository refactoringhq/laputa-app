import { test, expect } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

let tempVaultDir: string

async function openNote(page: import('@playwright/test').Page, title: string) {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 5_000 })
}

async function openPropertiesPanel(page: import('@playwright/test').Page) {
  const openPanelButton = page.getByRole('button', { name: 'Open the properties panel' })
  if (await openPanelButton.count()) {
    await openPanelButton.click()
  }
}

async function openFirstRelationshipInput(page: import('@playwright/test').Page) {
  const belongsToLabel = page.getByTestId('relationship-section-label').filter({ hasText: 'Belongs to' }).first()
  await expect(belongsToLabel).toBeVisible({ timeout: 5_000 })

  const addButton = page.getByTestId('add-relation-ref')
  await expect(addButton.first()).toBeVisible()
  await addButton.first().click()

  const input = page.getByTestId('add-relation-ref-input')
  await expect(input).toBeVisible()
  return input
}

function slugFromTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

test.describe('Create & open note from relationship input', () => {
  test.setTimeout(60_000)

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    tempVaultDir = createFixtureVaultCopy()
    await openFixtureVault(page, tempVaultDir, { expectedReadyTitle: 'Team Meeting' })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('creates note from relationship input without crash', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await openNote(page, 'Team Meeting')
    await openPropertiesPanel(page)

    const input = await openFirstRelationshipInput(page)
    const uniqueTitle = `Test Note ${Date.now()}`
    await input.fill(uniqueTitle)
    await page.waitForTimeout(300)

    const createOption = page.getByTestId('create-and-open-option')
    await expect(createOption).toBeVisible()

    await createOption.click()
    await page.waitForTimeout(2000)

    // No uncaught errors (especially no "Maximum update depth exceeded")
    const fatal = pageErrors.filter(e => e.includes('Maximum update depth'))
    expect(fatal).toHaveLength(0)

    // App is still visible — not blank/crashed
    await expect(page.locator('.app__editor')).toBeVisible()
  })

  test('only the new note tab is active after creation', async ({ page }) => {
    await openNote(page, 'Team Meeting')
    await openPropertiesPanel(page)

    const input = await openFirstRelationshipInput(page)
    const uniqueTitle = `Tab Test ${Date.now()}`
    await input.fill(uniqueTitle)
    await page.waitForTimeout(300)

    await page.getByTestId('create-and-open-option').click()
    await page.waitForTimeout(2000)

    // The newly created note should be the active single-note editor.
    await expect(page.locator('.app__editor')).toBeVisible()
    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(slugFromTitle(uniqueTitle), {
      timeout: 5_000,
    })
  })

  test('relationship wikilink is added to original note after creation', async ({ page }) => {
    await openNote(page, 'Team Meeting')
    await openPropertiesPanel(page)

    const input = await openFirstRelationshipInput(page)
    const uniqueTitle = `Link Test ${Date.now()}`
    await input.fill(uniqueTitle)
    await page.waitForTimeout(300)

    await page.getByTestId('create-and-open-option').click()
    await page.waitForTimeout(3000)

    // Navigate back to the original note (single-note model: replaces the newly created note)
    await openNote(page, 'Team Meeting')
    await page.waitForTimeout(2000)

    // The new wikilink should appear in the relationships
    const newRef = page.locator(`text=${uniqueTitle}`)
    await expect(newRef.first()).toBeVisible({ timeout: 8000 })
  })
})
