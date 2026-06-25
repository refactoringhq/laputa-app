import { expect, type Locator, type Page, test } from '@playwright/test'

async function openFirstNoteWithProperties(page: Page) {
  const noteList = page.locator('[data-testid="note-list-container"]')
  await noteList.waitFor({ timeout: 5000 })
  const items = noteList.locator('.cursor-pointer')
  const count = await items.count()
  test.skip(count === 0, 'No notes in note list')

  await items.nth(0).click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+Shift+i')
  await page.waitForTimeout(500)

  return { count, items, typeSelector: page.locator('[data-testid="type-selector"]') }
}

function isSelectableTypeLabel(text: string) {
  return text.length > 0 && !text.includes('Theme')
}

async function findOriginalType(page: Page, items: Locator, typeSelector: Locator, count: number) {
  const trigger = typeSelector.locator('button[role="combobox"]')
  for (let i = 0; i < Math.min(count, 10); i++) {
    await items.nth(i).click()
    await page.waitForTimeout(400)
    if (!(await typeSelector.isVisible())) {
      continue
    }
    const text = (await trigger.textContent())?.trim() ?? ''
    if (isSelectableTypeLabel(text)) {
      return text
    }
  }
  return ''
}

async function openRawEditor(page: Page) {
  await page.keyboard.press('Control+Backslash')
  const rawEditor = page.locator('[data-testid="raw-editor-codemirror"]')
  await expect(rawEditor).toBeVisible({ timeout: 3000 })
  await page.waitForTimeout(300)
}

async function findTypeLineIndex(page: Page, source: string) {
  return page.evaluate((pattern) => {
    const typeLine = new RegExp(pattern)
    return Array.from(document.querySelectorAll('.cm-line')).findIndex((line) =>
      typeLine.test(line.textContent ?? ''),
    )
  }, source)
}

async function replaceRawEditorLine(page: Page, lineIndex: number, value: string) {
  const typeLine = page.locator('.cm-line').nth(lineIndex)
  await typeLine.click()
  await page.waitForTimeout(100)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.type(value)
}

async function restoreOriginalType(page: Page, originalType: string) {
  const restoreLineIndex = await findTypeLineIndex(page, '^type:\\s')
  if (restoreLineIndex < 0) {
    return
  }

  await replaceRawEditorLine(page, restoreLineIndex, `type: ${originalType.replace(/Note$/, '')}`)
  await page.waitForTimeout(800)
}

test.describe('Raw editor type propagation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('editing type in raw editor immediately updates Properties panel', async ({ page }) => {
    const { count, items, typeSelector } = await openFirstNoteWithProperties(page)
    const originalType = await findOriginalType(page, items, typeSelector, count)
    test.skip(!originalType, 'No non-Theme note with type selector found')

    await openRawEditor(page)
    const typeLineIndex = await findTypeLineIndex(page, '^(?:type|Is A):\\s')
    test.skip(typeLineIndex < 0, 'No type field found in frontmatter')

    const newType = originalType.includes('Note') ? 'Project' : 'Note'
    await replaceRawEditorLine(page, typeLineIndex, `type: ${newType}`)

    // Wait for debounce (500ms) + state propagation
    await page.waitForTimeout(800)

    // Verify Properties panel shows the new type
    const trigger = typeSelector.locator('button[role="combobox"]')
    await expect(trigger).toContainText(newType, { timeout: 3000 })

    await restoreOriginalType(page, originalType)

    // Close raw editor
    await page.keyboard.press('Control+Backslash')
    await page.waitForTimeout(300)
  })
})
