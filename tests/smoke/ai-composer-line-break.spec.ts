import { test, expect } from '@playwright/test'

type MockHandlers = Record<string, (...args: unknown[]) => unknown>

test.describe('AI composer line break rendering', () => {
  test.beforeEach(async ({ page }) => {
    // The browser mock reports every CLI agent as missing, which disables the
    // composer. Patch the probe as the mock module initializes so the panel
    // renders enabled, like it does in the packaged app.
    await page.addInitScript(() => {
      let handlers: MockHandlers | undefined
      Object.defineProperty(window, '__mockHandlers', {
        configurable: true,
        get: () => handlers,
        set: (value: MockHandlers) => {
          handlers = value
          value.get_ai_agents_status = () => ({
            claude_code: { installed: true, version: '2.0.0' },
          })
        },
      })
    })
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 5_000 })

    await page.locator('.app__note-list .cursor-pointer').first().click()
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 3_000 })
    await page.getByRole('button', { name: 'Open the AI panel' }).click()
    await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: 3_000 })
  })

  test('shows the first Shift+Enter line break immediately', async ({ page }) => {
    const editor = page.getByTestId('agent-input')
    await editor.click()

    await page.keyboard.type('first line')
    const singleLineHeight = (await editor.boundingBox())?.height ?? 0
    expect(singleLineHeight).toBeGreaterThan(0)

    await page.keyboard.press('Shift+Enter')

    await expect.poll(() => editor.textContent()).toBe('first line\n\u200B')
    await expect
      .poll(async () => (await editor.boundingBox())?.height ?? 0)
      .toBeGreaterThan(singleLineHeight)
  })
})
