import { test, expect, type Page } from '@playwright/test'
import { executeCommand, openCommandPalette, sendShortcut } from './helpers'

const RAW_EDITOR = '.cm-content'

type MockHandler = (args?: Record<string, unknown>) => unknown

async function openFirstNote(page: Page) {
  await page.waitForSelector('[data-testid="sidebar-top-nav"]', { timeout: 10_000 })
  const noteList = page.locator('[data-testid="note-list-container"]')
  await noteList.waitFor({ timeout: 5_000 })
  await noteList.locator('.cursor-pointer').first().click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function setRawEditorContent(page: Page, content: string) {
  await page.evaluate((nextContent) => {
    const el = document.querySelector('.cm-content')
    if (!el) throw new Error('CodeMirror content element is missing')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = (el as any).cmTile?.view
    if (!view) throw new Error('CodeMirror view is missing')
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextContent },
    })
    view.focus()
  }, content)
}

async function openRawMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator(RAW_EDITOR)).toBeVisible({ timeout: 5_000 })
}

async function installFailOnceSaveMock(page: Page) {
  await page.waitForFunction(() => Boolean(window.__mockHandlers?.save_note_content))
  await page.evaluate(() => {
    const handlers = window.__mockHandlers as Record<string, MockHandler>
    const originalSaveNoteContent = handlers.save_note_content
    let shouldFail = true
    window.__laputaTest = {
      ...window.__laputaTest,
      saveAttempts: [],
    }
    handlers.save_note_content = (args?: Record<string, unknown>) => {
      window.__laputaTest?.saveAttempts?.push(args)
      if (shouldFail) {
        shouldFail = false
        throw new Error('The filename, directory name, or volume label syntax is incorrect. (os error 123)')
      }
      return originalSaveNoteContent?.(args)
    }
  })
}

test('failed Windows path saves show a recoverable toast and retry the draft', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (err) => { pageErrors.push(err.message) })
  await page.route('**/api/vault/ping', async (route) => {
    await route.fulfill({ status: 404, body: '' })
  })

  await page.goto('/')
  await openFirstNote(page)
  await installFailOnceSaveMock(page)

  await openRawMode(page)
  await setRawEditorContent(page, '# Retryable Windows Save\n\nDraft that must survive failure')
  await page.waitForTimeout(550)

  await sendShortcut(page, 's', ['Control'])
  await expect(page.locator('.fixed.bottom-8')).toContainText('note path is invalid on this platform', { timeout: 5_000 })
  expect(pageErrors.filter((message) => message.includes('os error 123'))).toHaveLength(0)

  await sendShortcut(page, 's', ['Control'])
  await expect(page.locator('.fixed.bottom-8')).toContainText('Saved', { timeout: 5_000 })

  const saveAttempts = await page.evaluate(() => window.__laputaTest?.saveAttempts ?? [])
  expect(saveAttempts).toHaveLength(2)
  expect(saveAttempts[1]).toEqual(expect.objectContaining({
    content: '# Retryable Windows Save\n\nDraft that must survive failure',
  }))
})
