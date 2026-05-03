import { expect, type Locator, type Page } from '@playwright/test'

interface SelectEditorTextRangeArgs {
  dataTestId: string
  startOffset: number
}

interface ClipboardWriteArgs {
  text: string
}

interface EditorSelectionRange {
  start: number
  end: number
}

interface EditorTarget {
  dataTestId: string
}

interface ExpectEditorSelectionRangeArgs {
  expectedRange: EditorSelectionRange
  target: EditorTarget
}

export function trackPageErrors(page: Page): string[] {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  return pageErrors
}

export async function expectNormalizedEditorText(
  editor: Locator,
  expectedText: string,
): Promise<void> {
  await expect
    .poll(async () => normalizeEditorText(await editor.textContent()))
    .toBe(expectedText)
}

export async function selectEditorTextRange(
  page: Page,
  dataTestId: string,
  startOffset: number,
): Promise<void> {
  await page.evaluate(selectEditorTextRangeInBrowser, { dataTestId, startOffset })
}

export async function expectNoPageErrors(pageErrors: string[]): Promise<void> {
  await expect
    .poll(async () => pageErrors, { timeout: 2_000 })
    .toEqual([])
}

export async function writeClipboardText(
  page: Page,
  { text }: ClipboardWriteArgs,
): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.evaluate(async ({ text: nextText }) => {
    await navigator.clipboard.writeText(nextText)
  }, { text })
}

export async function expectEditorSelectionRange(
  page: Page,
  { expectedRange, target }: ExpectEditorSelectionRangeArgs,
): Promise<void> {
  await expect
    .poll(
      async () => page.evaluate(readEditorSelectionRangeInBrowser, target),
      { timeout: 2_000 },
    )
    .toEqual(expectedRange)
}

function normalizeEditorText(value: string | null): string {
  return value?.replace(/\s+/g, ' ').trim() ?? ''
}

function selectEditorTextRangeInBrowser({
  dataTestId,
  startOffset,
}: SelectEditorTextRangeArgs): void {
  const editor = document.querySelector(`[data-testid="${dataTestId}"]`) as HTMLDivElement | null
  const selection = window.getSelection()
  const textNodes: Text[] = []
  if (editor) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text)
    }
  }
  const firstText = textNodes[0] ?? null
  const lastText = textNodes[textNodes.length - 1] ?? null
  const prerequisites = [selection, firstText, lastText]

  if (prerequisites.some(value => !value)) return
  const range = document.createRange()
  range.setStart(firstText, startOffset)
  range.setEnd(lastText, lastText.textContent?.length ?? 0)
  selection.removeAllRanges()
  selection.addRange(range)
}

function readEditorSelectionRangeInBrowser({
  dataTestId,
}: EditorTarget): EditorSelectionRange | null {
  const editor = document.querySelector(`[data-testid="${dataTestId}"]`) as HTMLDivElement | null
  const selection = window.getSelection()
  if (!editor || !selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null

  const startRange = document.createRange()
  startRange.selectNodeContents(editor)
  startRange.setEnd(range.startContainer, range.startOffset)

  const endRange = document.createRange()
  endRange.selectNodeContents(editor)
  endRange.setEnd(range.endContainer, range.endOffset)
  const normalizeSelectionText = (value: string) => value.replace(/\u200B/g, '')

  return {
    start: normalizeSelectionText(startRange.toString()).length,
    end: normalizeSelectionText(endRange.toString()).length,
  }
}
