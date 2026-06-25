import { expect, type Page, test } from '@playwright/test'
import { openCommandPalette, executeCommand } from './helpers'

const LIST_ITEM_MARKER = /^[-*+]\s/
const HEADING_MARKER = /^#{1,6}\s/

type MarkdownContent = string
type MarkdownLine = string
type LineWindow = {
  line: MarkdownLine
  nextLine: MarkdownLine
  lineAfter: MarkdownLine
}

async function openFirstNoteInBlockEditor(page: Page) {
  const noteListContainer = page.locator('[data-testid="note-list-container"]')
  await noteListContainer.waitFor({ timeout: 5000 })
  await noteListContainer.locator('.cursor-pointer').first().click()
  await page.waitForTimeout(500)

  const editorContainer = page.locator('.bn-editor')
  await expect(editorContainer).toBeVisible({ timeout: 5000 })
  return editorContainer
}

async function triggerSerialization(page: Page) {
  const editorContainer = await openFirstNoteInBlockEditor(page)
  await editorContainer.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' ')
  await page.waitForTimeout(300)
}

async function toggleRawEditor(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await page.waitForTimeout(500)
}

async function readRawEditorContent(page: Page) {
  const rawEditor = page.locator('[data-testid="raw-editor-codemirror"]')
  await expect(rawEditor).toBeVisible({ timeout: 5000 })

  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="raw-editor-codemirror"]')
    const cm = el?.querySelector('.cm-content')
    return cm?.textContent ?? ''
  })
}

function isBlankLine(line?: MarkdownLine) {
  return line?.trim() === ''
}

function isListItem(line?: MarkdownLine) {
  return LIST_ITEM_MARKER.test(line?.trim() ?? '')
}

function isHeading(line?: MarkdownLine) {
  return HEADING_MARKER.test(line?.trim() ?? '')
}

function hasBlankLineBetweenListItems(window: LineWindow) {
  if (!isListItem(window.line)) {
    return false
  }
  if (!isBlankLine(window.nextLine)) {
    return false
  }
  return isListItem(window.lineAfter)
}

function hasExtraBlankLinesAfterHeading(window: LineWindow) {
  if (!isHeading(window.line)) {
    return false
  }
  if (!isBlankLine(window.nextLine)) {
    return false
  }
  return isBlankLine(window.lineAfter)
}

function findThreeLineViolation(
  rawContent: MarkdownContent,
  hasViolation: (window: LineWindow) => boolean,
) {
  const lines = rawContent.split('\n')
  for (let i = 0; i < lines.length - 2; i++) {
    if (hasViolation({ line: lines[i], nextLine: lines[i + 1], lineAfter: lines[i + 2] })) {
      return { index: i, lines }
    }
  }
  return null
}

function expectNoBlankLinesBetweenListItems(rawContent: MarkdownContent) {
  const violation = findThreeLineViolation(rawContent, hasBlankLineBetweenListItems)
  if (!violation) {
    return
  }

  const line = violation.lines[violation.index]
  const lineAfter = violation.lines[violation.index + 2]
  throw new Error(
    `Found blank line between list items at line ${violation.index + 1}:\n` +
    `  "${line}"\n  (blank)\n  "${lineAfter}"\n` +
    'This indicates the serializer is adding extra blank lines between list items.',
  )
}

function expectNoExtraBlankLinesAfterHeadings(rawContent: MarkdownContent) {
  const violation = findThreeLineViolation(rawContent, hasExtraBlankLinesAfterHeading)
  if (!violation) {
    return
  }

  throw new Error(
    `Found multiple blank lines after heading at line ${violation.index + 1}:\n` +
    `  "${violation.lines[violation.index]}"\n  (blank)\n  (blank)\n` +
    'Headings should have at most one blank line after them.',
  )
}

test.describe('BlockNote serializer blank lines fix', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('tight lists are serialized without blank lines between items', async ({ page }) => {
    await triggerSerialization(page)
    await toggleRawEditor(page)
    const rawContent = await readRawEditorContent(page)

    // The mock content has bullet list items like "- First level item"
    // After BlockNote serialization, they should still be tight (no blank lines)
    expect(rawContent).toBeTruthy()
    expectNoBlankLinesBetweenListItems(rawContent)
  })

  test('saving without editing does not add whitespace changes', async ({ page }) => {
    await openFirstNoteInBlockEditor(page)

    await toggleRawEditor(page)
    const contentBefore = await readRawEditorContent(page)

    await toggleRawEditor(page)

    // Just click the editor without typing
    await page.locator('.bn-editor').click()
    await page.waitForTimeout(300)

    await toggleRawEditor(page)
    const contentAfter = await readRawEditorContent(page)

    expect(contentAfter).toBe(contentBefore)
  })

  test('headings do not have extra blank lines added after them', async ({ page }) => {
    await triggerSerialization(page)
    await toggleRawEditor(page)
    const rawContent = await readRawEditorContent(page)

    expectNoExtraBlankLinesAfterHeadings(rawContent)
  })
})
