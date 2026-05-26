import { test, expect } from '@playwright/test'

test.describe('AI chat empty body fix — no regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      type Handler = (args?: Record<string, unknown>) => unknown
      type BrowserWindow = Window & typeof globalThis & {
        __mockHandlers?: Record<string, Handler>
      }

      const installMockAiAgent = (handlers?: Record<string, Handler> | null) => {
        if (!handlers) return handlers ?? null
        handlers.get_ai_agents_status = () => ({
          claude_code: { installed: true, version: 'mock' },
          codex: { installed: false, version: null },
          opencode: { installed: false, version: null },
          pi: { installed: false, version: null },
          gemini: { installed: false, version: null },
          kiro: { installed: false, version: null },
        })
        return handlers
      }

      const browserWindow = window as BrowserWindow
      let ref = installMockAiAgent(browserWindow.__mockHandlers) ?? null
      Object.defineProperty(browserWindow, '__mockHandlers', {
        configurable: true,
        set(value) {
          ref = installMockAiAgent(value as Record<string, Handler> | undefined) ?? null
        },
        get() {
          return installMockAiAgent(ref) ?? ref
        },
      })
    })
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="note-list-container"]')).toBeVisible({ timeout: 5_000 })
  })

  test('AI panel opens, note is selected, message can be sent and response renders @smoke', async ({ page }) => {
    // Select a note so the AI panel has context
    const noteItem = page.locator('.app__note-list .cursor-pointer').first()
    await noteItem.click()

    // Verify editor has content (note body is loaded)
    const editor = page.locator('.bn-editor')
    await expect(editor).toBeVisible({ timeout: 3000 })

    // Open the AI panel from the editor toolbar
    await page.getByRole('button', { name: 'Open the AI panel' }).click()
    await expect(page.getByTestId('ai-workspace')).toBeVisible({ timeout: 3000 })
    await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: 3000 })
    await expect(page.getByTestId('ai-workspace-target-trigger')).toBeVisible()
    await expect(page.getByTestId('ai-workspace-permission-trigger')).toBeVisible()

    // Send a message
    const input = page.getByTestId('agent-input')
    await expect(input).toBeVisible()
    await input.fill('What does this note contain?')
    await page.getByTestId('agent-send').click()

    // Wait for mock AI response to render (mock returns fixed text after 300ms)
    await expect(page.getByTestId('ai-message').first()).toBeVisible({ timeout: 5000 })

    // Verify the response text is rendered (mock includes wikilinks)
    await expect(page.getByTestId('ai-message').first()).not.toBeEmpty()
  })
})
