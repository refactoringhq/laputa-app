import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { seedBlockNoteTable, triggerMenuCommand } from './testBridge'

let tempVaultDir: string
const TABLE_RELOAD_NOTE_PATH = '/project/table-reload-regression.md'
const TABLE_RELOAD_NOTE_TITLE = 'Table Reload Regression'
const TABLE_WIKILINK_NOTE_PATH = '/table-wikilink-regression.md'
const TABLE_WIKILINK_NOTE_TITLE = 'Table Wikilink Regression'
const TABLE_WIKILINK_TARGET = 'application-design-and-build'
const TABLE_WIKILINK_TARGET_TITLE = 'Application Design and Build'

function writeTableReloadNote(vaultDir: string): void {
  fs.writeFileSync(
    path.join(vaultDir, TABLE_RELOAD_NOTE_PATH.slice(1)),
    `---
title: ${TABLE_RELOAD_NOTE_TITLE}
isA: Project
status: draft
---
# ${TABLE_RELOAD_NOTE_TITLE}

| Head 1 | Head 2 | Head 3 |
| --- | --- | --- |
| A | B | C |
| D | E | F |
`,
  )
}

function writeTableWikilinkNotes(vaultDir: string): void {
  fs.writeFileSync(
    path.join(vaultDir, `${TABLE_WIKILINK_TARGET}.md`),
    `---
title: ${TABLE_WIKILINK_TARGET_TITLE}
type: Note
---
# ${TABLE_WIKILINK_TARGET_TITLE}

Target note for table wikilink navigation.
`,
  )

  fs.writeFileSync(
    path.join(vaultDir, TABLE_WIKILINK_NOTE_PATH.slice(1)),
    `---
title: ${TABLE_WIKILINK_NOTE_TITLE}
type: Note
---
# ${TABLE_WIKILINK_NOTE_TITLE}

| Domain | Weight |
| --- | --- |
| [[${TABLE_WIKILINK_TARGET}]] | 99% |

## Domain Links
- [[${TABLE_WIKILINK_TARGET}]]
`,
  )
}

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

async function openTableHandleMenu(
  page: Page,
  orientation: 'row' | 'column',
  source: { rowIndex: number; cellIndex: number },
): Promise<void> {
  await tableCell(page, source.rowIndex, source.cellIndex).hover()
  const handle = await visibleTableHandle(page, orientation)
  await handle.click({ force: true })
}

async function clickTableHandleMenuItem(page: Page, name: string): Promise<void> {
  await page.getByRole('menuitem', { name }).click()
}

async function addTableRowBelow(page: Page): Promise<void> {
  await openTableHandleMenu(page, 'row', { rowIndex: 1, cellIndex: 0 })
  await clickTableHandleMenuItem(page, 'Add row below')
}

async function addTableColumnRight(page: Page): Promise<void> {
  await openTableHandleMenu(page, 'column', { rowIndex: 0, cellIndex: 1 })
  await clickTableHandleMenuItem(page, 'Add column right')
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

  test('hovered table handles survive a frontmatter reload before later table interaction', async ({ page }) => {
    const errors = trackUnexpectedErrors(page)

    writeTableReloadNote(tempVaultDir)
    await openFixtureVaultTauri(page, tempVaultDir)
    const tableReloadNote = page
      .getByTestId('note-list-container')
      .locator('[data-note-path]')
      .filter({ hasText: TABLE_RELOAD_NOTE_TITLE })
      .first()
    await expect(tableReloadNote).toBeVisible({ timeout: 5_000 })
    const tableReloadNotePath = await tableReloadNote.getAttribute('data-note-path')
    if (!tableReloadNotePath) {
      throw new Error('Table reload fixture is missing data-note-path')
    }
    await tableReloadNote.click()

    await expect(page.locator('table tr')).toHaveCount(3, { timeout: 5_000 })
    await tableCell(page, 1, 0).hover()
    await visibleTableHandle(page, 'row')

    await page.evaluate(async (notePath) => {
      const updateFrontmatter = window.__mockHandlers?.update_frontmatter
      if (typeof updateFrontmatter !== 'function') {
        throw new Error('Fixture vault is missing update_frontmatter')
      }
      await updateFrontmatter({ path: notePath, key: 'status', value: 'reviewed' })
    }, tableReloadNotePath)
    await triggerMenuCommand(page, 'vault-reload')

    await expect(page.locator('table')).toHaveCount(1)
    await moveAcrossElement(page, 'div.tableWrapper')
    await page.locator('table th').first().hover()
    await page.locator('table td').last().hover()

    const trailingParagraph = page.locator('.bn-editor [data-content-type="paragraph"]').last()
    await trailingParagraph.click()
    await page.keyboard.type('stable after table reload')

    const editor = page.getByRole('textbox').last()
    await expect(editor).toContainText('stable after table reload')
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

  test('adding table rows and columns from handle menus keeps selection valid', async ({ page }) => {
    const errors = trackUnexpectedErrors(page)

    await openFixtureVaultTauri(page, tempVaultDir)
    await createUntitledNote(page)
    await seedBlockNoteTable(page, [180, 120, 120])

    await expect(page.locator('table tr')).toHaveCount(3, { timeout: 5_000 })
    await expect(page.locator('table tr').first().locator('th,td')).toHaveCount(3)

    await addTableRowBelow(page)
    await expect(page.locator('table tr')).toHaveCount(4)

    await addTableColumnRight(page)
    await expect(page.locator('table tr').first().locator('th,td')).toHaveCount(4)

    await addTableRowBelow(page)
    await expect(page.locator('table tr')).toHaveCount(5)

    await addTableColumnRight(page)
    await expect(page.locator('table tr').first().locator('th,td')).toHaveCount(5)

    const trailingParagraph = page.locator('.bn-editor [data-content-type="paragraph"]').last()
    await trailingParagraph.click()
    await page.keyboard.type('stable after table row and column adds')

    const editor = page.getByRole('textbox').last()
    await expect(editor).toContainText('stable after table row and column adds')
    await expect(page.locator('table')).toHaveCount(1)
    expect(errors).toEqual([])
  })

  test('@smoke wikilinks inside table cells render and navigate', async ({ page }) => {
    const errors = trackUnexpectedErrors(page)

    writeTableWikilinkNotes(tempVaultDir)
    await openFixtureVaultTauri(page, tempVaultDir)
    const tableNote = page
      .getByTestId('note-list-container')
      .locator('[data-note-path]')
      .filter({ hasText: TABLE_WIKILINK_NOTE_TITLE })
      .first()
    await expect(tableNote).toBeVisible({ timeout: 5_000 })
    await tableNote.click()

    const tableWikilink = page
      .locator('table .wikilink')
      .filter({ hasText: TABLE_WIKILINK_TARGET_TITLE })
      .first()
    await expect(tableWikilink).toBeVisible({ timeout: 5_000 })
    await expect(tableWikilink).toHaveAttribute('data-target', TABLE_WIKILINK_TARGET)

    await tableWikilink.click({ modifiers: ['Meta'] })
    await expect(page.locator('.bn-editor h1').first()).toHaveText(TABLE_WIKILINK_TARGET_TITLE, { timeout: 5_000 })
    expect(errors).toEqual([])
  })
})
