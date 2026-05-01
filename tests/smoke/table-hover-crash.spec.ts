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

function tableCell(page: Page, rowIndex: number, cellIndex: number) {
  return page.locator('table tr').nth(rowIndex).locator('th,td').nth(cellIndex)
}

async function visibleTableHandle(page: Page, orientation: 'row' | 'column') {
  const handles = page.locator('.bn-table-handle[draggable="true"]')
  await expect(handles).toHaveCount(2, { timeout: 5_000 })

  const handleIndex = await handles.evaluateAll((elements, expectedOrientation) => {
    const positions = elements.map((element, index) => {
      const rect = element.getBoundingClientRect()
      return { index, x: rect.x, y: rect.y }
    })

    positions.sort((left, right) => (
      expectedOrientation === 'row'
        ? left.x - right.x
        : left.y - right.y
    ))

    return positions[0]?.index ?? 0
  }, orientation)

  return handles.nth(handleIndex)
}

async function dragTableHandle(
  page: Page,
  orientation: 'row' | 'column',
  source: { rowIndex: number; cellIndex: number },
  target: { rowIndex: number; cellIndex: number },
): Promise<void> {
  const sourceCell = tableCell(page, source.rowIndex, source.cellIndex)
  await sourceCell.hover()

  const handle = await visibleTableHandle(page, orientation)
  const targetCell = tableCell(page, target.rowIndex, target.cellIndex)

  const handleBox = await handle.boundingBox()
  const targetBox = await targetCell.boundingBox()
  expect(handleBox).not.toBeNull()
  expect(targetBox).not.toBeNull()
  if (!handleBox || !targetBox) return

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 12 },
  )
  await page.mouse.up()
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

  test('dragging table row and column handles completes without editor errors', async ({ page }) => {
    const errors = trackUnexpectedErrors(page)

    await openFixtureVaultTauri(page, tempVaultDir)
    await createUntitledNote(page)
    await seedBlockNoteTable(page, [180, 120, 120])

    await expect(page.locator('table tr')).toHaveCount(3, { timeout: 5_000 })

    await dragTableHandle(
      page,
      'row',
      { rowIndex: 1, cellIndex: 0 },
      { rowIndex: 2, cellIndex: 0 },
    )
    await expect(page.locator('table')).toHaveCount(1)

    await dragTableHandle(
      page,
      'column',
      { rowIndex: 0, cellIndex: 0 },
      { rowIndex: 0, cellIndex: 1 },
    )

    const trailingParagraph = page.locator('.bn-editor [data-content-type="paragraph"]').last()
    await trailingParagraph.click()
    await page.keyboard.type('stable after table handle drags')

    const editor = page.getByRole('textbox').last()
    await expect(editor).toContainText('stable after table handle drags')
    await expect(page.locator('table')).toHaveCount(1)
    expect(errors).toEqual([])
  })
})
