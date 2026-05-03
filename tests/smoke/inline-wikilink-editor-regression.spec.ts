import { test, expect } from '@playwright/test'
import {
  expectEditorSelectionRange,
  expectNoPageErrors,
  expectNormalizedEditorText,
  selectEditorTextRange,
  trackPageErrors,
  writeClipboardText,
} from './inlineWikilinkEditorHelpers'

test.describe('Inline wikilink editor regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 5_000 })

    await page.locator('.app__note-list .cursor-pointer').first().click()
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 3_000 })
    await page.getByRole('button', { name: 'Open the AI panel' }).click()
    await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: 3_000 })
  })

  test('keeps plain character typing stable in the AI panel chat input', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    const editor = page.getByTestId('agent-input')
    await expect(editor).toBeFocused()

    await page.keyboard.type('luca')

    await expectNormalizedEditorText(editor, 'luca')
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 4, end: 4 },
      target: { dataTestId: 'agent-input' },
    })
    await expectNoPageErrors(pageErrors)
  })

  test('keeps select-all cut scoped to the AI panel chat input', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    const editor = page.getByTestId('agent-input')
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await expect(editor).toBeFocused()

    await page.keyboard.type('luca')
    await page.keyboard.press('Meta+A')
    await page.keyboard.press('Meta+X')

    await expect(page.getByTestId('ai-panel')).toBeVisible()
    await expectNormalizedEditorText(editor, '')
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('luca')
    await expectNoPageErrors(pageErrors)
  })

  test('keeps inline chip editing stable after insertion and range deletion', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    const editor = page.getByTestId('agent-input')
    await expect(editor).toBeFocused()

    await page.keyboard.type('edit my [[b')
    await expect(page.getByTestId('wikilink-menu')).toContainText('Build Laputa App')

    await page.getByTestId('wikilink-menu').getByText('Build Laputa App').click()
    await expect(editor.getByTestId('inline-wikilink-chip')).toContainText('Build Laputa App')

    await page.keyboard.type(' essay')
    await expectNormalizedEditorText(editor, 'edit my Build Laputa App essay')

    await selectEditorTextRange(page, 'agent-input', 5)
    await page.keyboard.press('Backspace')

    await expect(editor).toBeVisible()
    await expectNoPageErrors(pageErrors)
  })

  test('keeps pasted text, caret movement, and selection replacement stable in the AI panel chat input', async ({ page }) => {
    const pageErrors = trackPageErrors(page)
    const agentInputTarget = { dataTestId: 'agent-input' }
    const editor = page.getByTestId('agent-input')
    await expect(editor).toBeFocused()

    await writeClipboardText(page, { text: 'hello world' })
    await page.keyboard.press('Meta+V')
    await expectNormalizedEditorText(editor, 'hello world')
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 11, end: 11 },
      target: agentInputTarget,
    })

    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('ArrowLeft')
    }
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 6, end: 6 },
      target: agentInputTarget,
    })

    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 6, end: 8 },
      target: agentInputTarget,
    })

    await page.keyboard.type('XY')
    await expectNormalizedEditorText(editor, 'hello XYrld')
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 8, end: 8 },
      target: agentInputTarget,
    })

    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('ArrowRight')
    }
    await expectEditorSelectionRange(page, {
      expectedRange: { start: 11, end: 11 },
      target: agentInputTarget,
    })

    await page.keyboard.press('Backspace')
    await expectNormalizedEditorText(editor, 'hello XYrl')
    await expectNoPageErrors(pageErrors)
  })
})
