import { test, expect, type Page } from '@playwright/test'
import { sendShortcut } from './helpers'

interface RawEditorState {
  lineCount: number
  lineIndex: number
  lineText: string
  nearbyLineTexts: string[]
  scrollTop: number
}

interface RawLineTarget {
  lineIndex: number
  targetLine: string
}

function findMarkdownBodyStart(lines: string[]) {
  if (lines[0] !== '---') {
    return 0
  }

  const frontmatterEnd = lines.indexOf('---', 1)
  return frontmatterEnd === -1 ? 0 : frontmatterEnd + 1
}

function isPreferredBodyLine(line: string) {
  const trimmed = line.trim()
  return trimmed !== ''
    && !trimmed.startsWith('#')
    && !trimmed.startsWith('- ')
    && !trimmed.startsWith('* ')
    && !trimmed.startsWith('|')
    && trimmed !== '---'
    && !/^\d+\.\s/.test(trimmed)
}

function clampPreferredLineIndex(lines: string[], bodyStart: number, seedIndex: number) {
  let lineIndex = seedIndex

  while (lineIndex > bodyStart && !isPreferredBodyLine(lines[lineIndex] ?? '')) {
    lineIndex -= 1
  }

  if (isPreferredBodyLine(lines[lineIndex] ?? '')) {
    return lineIndex
  }

  const firstPreferredIndex = lines.findIndex((line, index) => index >= bodyStart && isPreferredBodyLine(line))
  if (firstPreferredIndex !== -1) {
    return firstPreferredIndex
  }

  const firstNonEmptyIndex = lines.findIndex((line, index) => index >= bodyStart && line.trim() !== '')
  return firstNonEmptyIndex === -1 ? bodyStart : firstNonEmptyIndex
}

function rawOffsetForLine(lines: string[], lineIndex: number) {
  return lines
    .slice(0, lineIndex)
    .reduce((sum, line) => sum + line.length + 1, 0)
}

async function openRawEditor(page: Page) {
  await sendShortcut(page, 'Backslash', ['Control'])
  await expect(page.locator('[data-testid="raw-editor-codemirror"]')).toBeVisible({ timeout: 5_000 })
}

async function openRichEditor(page: Page) {
  await sendShortcut(page, 'Backslash', ['Control'])
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function getRawEditorState(page: Page): Promise<RawEditorState> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="raw-editor-codemirror"]')
    const view = host && host.__cmView
    if (!view) {
      return {
        lineCount: 0,
        lineIndex: 0,
        lineText: '',
        nearbyLineTexts: [],
        scrollTop: 0,
      }
    }

    const content = view.state.doc.toString()
    const lines = content.split('\n')
    const head = view.state.selection.main.head
    let running = 0
    let lineIndex = 0

    for (let index = 0; index < lines.length; index++) {
      const nextOffset = running + lines[index].length
      if (head <= nextOffset) {
        lineIndex = index
        break
      }
      running = nextOffset + 1
      lineIndex = index
    }

    return {
      lineCount: lines.length,
      lineIndex,
      lineText: lines[lineIndex] ?? '',
      nearbyLineTexts: lines.slice(Math.max(0, lineIndex - 1), Math.min(lines.length, lineIndex + 2)).map(line => line.trim()),
      scrollTop: view.scrollDOM.scrollTop,
    }
  })
}

async function getRawEditorLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="raw-editor-codemirror"]')
    const view = host && host.__cmView
    return view ? view.state.doc.toString().split('\n') : []
  })
}

async function findLongestNoteIndex(page: Page): Promise<number> {
  const noteItems = page.locator('[data-testid="note-list-container"] .cursor-pointer')
  const count = await noteItems.count()
  let bestIndex = 0
  let bestLineCount = 0

  for (let index = 0; index < Math.min(count, 8); index++) {
    await noteItems.nth(index).click()
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
    await openRawEditor(page)
    const state = await getRawEditorState(page)
    if (state.lineCount > bestLineCount) {
      bestLineCount = state.lineCount
      bestIndex = index
    }
    await openRichEditor(page)
  }

  return bestIndex
}

async function selectDeepRawBodyLine(page: Page): Promise<RawLineTarget> {
  const lines = await getRawEditorLines(page)
  const bodyStart = findMarkdownBodyStart(lines)
  const seedIndex = Math.max(bodyStart, Math.floor((bodyStart + lines.length - 1) * 0.75))
  const lineIndex = Math.max(0, clampPreferredLineIndex(lines, bodyStart, seedIndex))
  const offset = rawOffsetForLine(lines, lineIndex)

  await page.evaluate(({ nextOffset }) => {
    const host = document.querySelector('[data-testid="raw-editor-codemirror"]')
    const view = host && host.__cmView
    if (!view) {
      return
    }

    view.dispatch({ selection: { anchor: nextOffset, head: nextOffset } })
    view.focus()
    view.scrollDOM.scrollTop = Math.max(0, view.scrollDOM.scrollHeight * 0.7)
  }, { nextOffset: offset })

  return { lineIndex, targetLine: lines[lineIndex]?.trim() ?? '' }
}

test.describe('Editor mode position preservation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.locator('[data-testid="note-list-container"]').waitFor({ timeout: 5_000 })
  })

  test('keeps editing context near the same content when toggling raw and rich modes', async ({ page }) => {
    const noteItems = page.locator('[data-testid="note-list-container"] .cursor-pointer')
    const longestNoteIndex = await findLongestNoteIndex(page)

    await noteItems.nth(longestNoteIndex).click()
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
    await openRawEditor(page)

    const target = await selectDeepRawBodyLine(page)
    expect(target.targetLine).not.toBe('')

    const rawBefore = await getRawEditorState(page)
    await openRichEditor(page)
    expect(rawBefore.scrollTop).toBeGreaterThan(0)

    await openRawEditor(page)
    const rawAfter = await getRawEditorState(page)

    expect(rawBefore.lineText.trim()).toBe(target.targetLine)
    expect(rawAfter.nearbyLineTexts).toContain(target.targetLine)
  })
})
