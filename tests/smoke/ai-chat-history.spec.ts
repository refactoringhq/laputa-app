import { test, expect } from '@playwright/test'
import { sendShortcut } from './helpers'

test.describe('AI chat conversation history', () => {
  test.beforeEach(async ({ page }) => {
    // Block vault API so mock entries are used
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))

    await page.goto('/')
    await page.waitForTimeout(500)

    // Select a note so the AI panel has context
    const noteItem = page.locator('.app__note-list .cursor-pointer').first()
    await noteItem.click()
    await page.waitForTimeout(500)

    // Open AI Chat with the current keyboard shortcut.
    await sendShortcut(page, 'L', ['Meta', 'Shift'])
    await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: 3000 })
  })

  test('first message renders a mocked AI response', async ({ page }) => {
    // Find the input and send a message
    const input = page.getByTestId('agent-input')
    await input.fill('Hello')
    await page.getByTestId('agent-send').click()

    // Wait for mock response to appear
    const response = page.getByTestId('ai-message').last()
    await expect(response).toBeVisible({ timeout: 5000 })

    await expect(response).toContainText('[mock-claude code]')
    await expect(response).toContainText('You said: "Hello"')
  })

  test('second message appends to the current visible conversation', async ({ page }) => {
    // Send first message
    const input = page.getByTestId('agent-input')
    await input.fill('What is 2+2?')
    await page.getByTestId('agent-send').click()

    // Wait for first response to appear
    const firstResponse = page.getByTestId('ai-message').last()
    await expect(firstResponse).toBeVisible({ timeout: 5000 })
    await expect(firstResponse).toContainText('[mock-claude code]')

    // Send second message
    await input.fill('What was my previous question?')
    await page.getByTestId('agent-send').click()

    const messages = page.getByTestId('ai-message')
    await expect(messages).toHaveCount(2)
    await expect(messages.first()).toContainText('What is 2+2?')
    const secondResponse = page.getByTestId('ai-message').last()
    await expect(secondResponse).toContainText('What was my previous question?', { timeout: 5000 })
  })

  test('history resets after clearing conversation', async ({ page }) => {
    // Send first message
    const input = page.getByTestId('agent-input')
    await input.fill('Hello')
    await page.getByTestId('agent-send').click()

    // Wait for response
    const firstResponse = page.getByTestId('ai-message').last()
    await expect(firstResponse).toBeVisible({ timeout: 5000 })

    // Clear conversation (click the + button)
    await page.locator('button[title="New AI chat"]').click()
    await page.waitForTimeout(300)

    // Messages should be cleared
    await expect(page.getByTestId('ai-message')).toHaveCount(0)

    // Send new message — should have no history
    await input.fill('Fresh start')
    await page.getByTestId('agent-send').click()

    const freshResponse = page.getByTestId('ai-message').last()
    await expect(freshResponse).toBeVisible({ timeout: 5000 })
    await expect(freshResponse).toContainText('[mock-claude code]')
    await expect(freshResponse).toContainText('You said: "Fresh start"')
  })

  test('closing and reopening restores the last chat until a new AI chat is started', async ({ page }) => {
    const input = page.getByTestId('agent-input')
    await input.fill('Keep this thread alive')
    await page.getByTestId('agent-send').click()

    const firstResponse = page.getByTestId('ai-message').last()
    await expect(firstResponse).toContainText('[mock-claude code]', { timeout: 5000 })

    await page.getByTitle('Close AI panel').click()
    await expect(page.getByTestId('ai-panel')).toHaveCount(0)

    await sendShortcut(page, 'L', ['Meta', 'Shift'])
    const panel = page.getByTestId('ai-panel')
    await expect(panel).toBeVisible({ timeout: 3_000 })
    const restoredMessage = page.getByTestId('ai-message').last()
    await expect(restoredMessage).toContainText('Keep this thread alive')
    await expect(restoredMessage).toContainText('[mock-claude code]')

    await page.getByTitle('New AI chat').focus()
    await expect(page.getByTitle('New AI chat')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('ai-message')).toHaveCount(0)
  })
})
