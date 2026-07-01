import { test, expect, type Page } from '@playwright/test'
import { installMockAiAgent, openCommandPalette } from './helpers'
import {
  expectEditorSelectionRange,
  expectNoPageErrors,
  expectNormalizedEditorText,
  selectEditorTextRange,
  trackPageErrors,
  writeClipboardText,
} from './inlineWikilinkEditorHelpers'

async function readCaretGapAfterChip(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector('[data-testid="command-palette-ai-input"]')
    if (!(editor instanceof HTMLElement)) return null

    const chip = editor.querySelector('[data-testid="inline-wikilink-chip"]')
    if (!(chip instanceof HTMLElement)) return null

    const selection = window.getSelection()
    if (selection === null) return null
    if (selection.rangeCount === 0) return null

    const range = selection.getRangeAt(0).cloneRange()
    range.collapse(true)

    const caretRect = range.getBoundingClientRect()
    if (caretRect.height === 0) return null

    return caretRect.left - chip.getBoundingClientRect().right
  })
}

async function expectCaretAfterChip(page: Page) {
  await expect.poll(() => readCaretGapAfterChip(page)).toBeLessThan(24)
}

test.describe('Command palette AI mode regression', () => {
  test.beforeEach(async ({ page }) => {
    await installMockAiAgent(page)
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 5_000 })
  })

  test('keeps focus, supports inline chip edits, and survives selection deletion', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    await openCommandPalette(page)
    await page.locator('input[placeholder="Type a command..."]').pressSequentially(' ')

    const aiInput = page.getByTestId('command-palette-ai-input')
    await expect(aiInput).toBeVisible()
    await expect(aiInput).toBeFocused()

    await page.keyboard.type('a')
    await expect(aiInput).toBeVisible()
    await expect(aiInput).toBeFocused()
    await expect(page.locator('input[placeholder="Type a command..."]')).toHaveCount(0)
    await expectNormalizedEditorText(aiInput, 'a')
    await page.keyboard.press('Backspace')

    await page.keyboard.type('edit my [[b')
    await expect(page.getByTestId('wikilink-menu')).toContainText('Build Laputa App')

    await page.getByTestId('wikilink-menu').getByText('Build Laputa App').click()
    await expect(aiInput.getByTestId('inline-wikilink-chip')).toContainText('Build Laputa App')
    await expectCaretAfterChip(page)

    await page.keyboard.type(' essay')
    await expectNormalizedEditorText(aiInput, 'edit my Build Laputa App essay')

    await selectEditorTextRange(page, 'command-palette-ai-input', 5)
    await page.keyboard.press('Backspace')

    await expect(aiInput).toBeVisible()
    await expectNoPageErrors(pageErrors)
  })

  test('submits an arbitrary prompt and opens the AI workspace without a render error', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    await openCommandPalette(page)
    await page.locator('input[placeholder="Type a command..."]').pressSequentially(' ')

    const aiInput = page.getByTestId('command-palette-ai-input')
    await expect(aiInput).toBeVisible()
    await expect(aiInput).toBeFocused()

    await aiInput.pressSequentially('random prompt')
    await expectNormalizedEditorText(aiInput, 'random prompt')
    await page.keyboard.press('Enter')

    await expect(page.locator('[data-command-palette="true"]')).toHaveCount(0)
    await expect(page.getByTestId('ai-workspace')).toBeVisible()
    await expectNoPageErrors(pageErrors)
  })

  test('keeps pasted text, caret movement, and selection replacement stable in AI mode', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    const aiInputTarget = { dataTestId: 'command-palette-ai-input' }
    await openCommandPalette(page)
    await page.locator('input[placeholder="Type a command..."]').pressSequentially(' ')

    const aiInput = page.getByTestId('command-palette-ai-input')
    await expect(aiInput).toBeVisible()
    await expect(aiInput).toBeFocused()

    await writeClipboardText(page, { text: 'hello world' })
    await page.keyboard.press('Meta+V')
    await expectNormalizedEditorText(aiInput, 'hello world')
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 12, end: 12 },
      target: aiInputTarget,
    })

    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('ArrowLeft')
    }
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 7, end: 7 },
      target: aiInputTarget,
    })

    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 7, end: 9 },
      target: aiInputTarget,
    })

    await page.keyboard.type('XY')
    await expectNormalizedEditorText(aiInput, 'hello XYrld')
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 9, end: 9 },
      target: aiInputTarget,
    })

    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('ArrowRight')
    }
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 12, end: 12 },
      target: aiInputTarget,
    })

    await page.keyboard.press('Backspace')
    await expectNormalizedEditorText(aiInput, 'hello XYrl')
    await expectNoPageErrors(pageErrors)
  })

  test('submits a quick prompt and opens the AI workspace without render errors', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    await openCommandPalette(page)
    await page.locator('input[placeholder="Type a command..."]').pressSequentially(' ')

    const aiInput = page.getByTestId('command-palette-ai-input')
    await expect(aiInput).toBeVisible()
    await expect(aiInput).toBeFocused()

    await page.keyboard.type('summarize the active note')
    await page.keyboard.press('Enter')

    await expect(page.getByTestId('ai-workspace')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('ai-panel')).toBeVisible()
    await expect(page.getByTestId('ai-message').first()).toContainText(
      'summarize the active note',
      { timeout: 5_000 },
    )
    await expectNoPageErrors(pageErrors)
  })
})
