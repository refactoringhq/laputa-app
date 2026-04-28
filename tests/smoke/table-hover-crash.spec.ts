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
    errors.push(text)
  })

  return errors
}

async function createUntitledNote(page: Page): Promise<void> {
  await triggerMenuCommand(page, 'file-new-note')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function moveAcrossElement(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first()
  await expect(target).toBeVisible({ timeout: 5_000 })
  const box = await target.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return

  const points = [
    { x: box.x + 2, y: box.y + 2 },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: box.x + Math.max(2, box.width - 2), y: box.y + Math.max(2, box.height - 2) },
  ]

  for (const point of points) {
    await page.mouse.move(point.x, point.y, { steps: 4 })
  }
}

test.describe('table hover crash regression', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page
    testInfo.setTimeout(60_000)
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('moving through table wrappers, cells, and nearby text keeps the editor stable', async ({ page }) => {
    const errors = trackUnexpectedErrors(page)

    await openFixtureVaultTauri(page, tempVaultDir)
    await createUntitledNote(page)
    await seedBlockNoteTable(page, [180, 120, 120])

    await expect(page.locator('div.tableWrapper')).toBeVisible({ timeout: 5_000 })
    await moveAcrossElement(page, 'div.tableWrapper')
    await page.locator('table th').first().hover()
    await page.locator('table td').first().hover()

    const trailingParagraph = page.locator('.bn-editor [data-content-type="paragraph"]').last()
    await trailingParagraph.hover()
    await trailingParagraph.click()
    await page.keyboard.type('stable after table hover')

    const editor = page.getByRole('textbox').last()
    await expect(editor).toContainText('stable after table hover')
    await expect(page.locator('table')).toHaveCount(1)
    expect(errors).toEqual([])
  })
})
