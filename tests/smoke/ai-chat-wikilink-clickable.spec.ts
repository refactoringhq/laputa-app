import { test, expect } from '@playwright/test'
import { installMockAiAgent } from './helpers'
import { triggerMenuCommand } from './testBridge'

test.describe('AI chat wikilink rendering', () => {
  test.beforeEach(async ({ page }) => {
    await installMockAiAgent(page)

    // Block vault API so mock entries are used (ensures "Build Laputa App" exists)
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 5_000 })

    // Select a note so the AI panel has context
    const noteItem = page.locator('.app__note-list .cursor-pointer').first()
    await noteItem.click()
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 3_000 })

    await page.getByRole('button', { name: 'Open the AI panel' }).click()
    await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: 3000 })

    // Send a message to trigger mock response with [[Build Laputa App]] and [[Matteo Cellini]]
    const input = page.getByTestId('agent-input')
    await input.fill('Tell me about this note')
    await page.getByTestId('agent-send').click()

    // Wait for wikilinks to render
    await expect(page.locator('.chat-wikilink').first()).toBeVisible({ timeout: 5000 })
  })

  test('[[Note]] in AI response renders as clickable wikilink', async ({ page }) => {
    const wikilink = page.locator('.chat-wikilink').first()

    // Verify wikilink text and attributes
    await expect(wikilink).toHaveText('Build Laputa App')
    await expect(wikilink).toHaveAttribute('data-wikilink-target', 'Build Laputa App')
    await expect(wikilink).toHaveAttribute('role', 'link')

    // Verify second wikilink
    const secondWikilink = page.locator('.chat-wikilink').nth(1)
    await expect(secondWikilink).toHaveText('Matteo Cellini')

    // Verify multiple wikilinks rendered
    await expect(page.locator('.chat-wikilink')).toHaveCount(2)

    await expect(wikilink).toHaveCSS('cursor', 'pointer')
  })

  test('clicking a wikilink opens the target note in the editor', async ({ page }) => {
    // Click the second wikilink ("Matteo Cellini") which is NOT already open.
    const wikilink = page.locator('.chat-wikilink').nth(1)
    await expect(wikilink).toHaveText('Matteo Cellini')

    await wikilink.click()

    await expect(page.locator('.bn-editor h1').first()).toHaveText('Matteo Cellini', { timeout: 5_000 })
  })

  test('clicking a wikilink after vault reload opens the target note without editor block-id crash', async ({ page }) => {
    const editorCrashMessages = [''].slice(1)
    page.on('pageerror', error => {
      editorCrashMessages.push(error.message)
    })
    page.on('console', message => {
      if (message.type() === 'error') {
        editorCrashMessages.push(message.text())
      }
    })

    await triggerMenuCommand(page, 'vault-reload')
    await expect(page.getByText(/Vault reloaded \(\d+ entries\)/).last()).toBeVisible({
      timeout: 5_000,
    })
    await expect(page.locator('.chat-wikilink')).toHaveCount(2)

    const wikilink = page.locator('.chat-wikilink').nth(1)
    await expect(wikilink).toHaveText('Matteo Cellini')

    await wikilink.click()

    await expect(page.locator('.bn-editor h1').first()).toHaveText('Matteo Cellini', { timeout: 5_000 })
    expect(editorCrashMessages.filter(message => message.includes("Block doesn't have id"))).toEqual([])
  })
})
