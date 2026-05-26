import { test, expect, type Page } from '@playwright/test'
import { installMockAiAgent, sendShortcut } from './helpers'

function visibleAgentInput(page: Page) {
  return page.locator('[data-testid="agent-input"]:visible')
}

function visibleAgentSend(page: Page) {
  return page.locator('[data-testid="agent-send"]:visible')
}

function visibleAiMessages(page: Page) {
  return page.locator('[data-testid="ai-message"]:visible')
}

test.describe('AI chat conversation history', () => {
  test.beforeEach(async ({ page }) => {
    await installMockAiAgent(page)
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
    const input = visibleAgentInput(page)
    await input.fill('Hello')
    await visibleAgentSend(page).click()

    // Wait for mock response to appear
    const response = visibleAiMessages(page).last()
    await expect(response).toBeVisible({ timeout: 5000 })

    await expect(response).toContainText('[mock-claude code]')
    await expect(response).toContainText('You said: "Hello"')
  })

  test('second message appends to the current visible conversation', async ({ page }) => {
    // Send first message
    const input = visibleAgentInput(page)
    await input.fill('What is 2+2?')
    await visibleAgentSend(page).click()

    // Wait for first response to appear
    const firstResponse = visibleAiMessages(page).last()
    await expect(firstResponse).toBeVisible({ timeout: 5000 })
    await expect(firstResponse).toContainText('[mock-claude code]')

    // Send second message
    await input.fill('What was my previous question?')
    await visibleAgentSend(page).click()

    const messages = visibleAiMessages(page)
    await expect(messages).toHaveCount(2)
    await expect(messages.first()).toContainText('What is 2+2?')
    const secondResponse = page.getByTestId('ai-message').last()
    await expect(secondResponse).toContainText('What was my previous question?', { timeout: 5000 })
  })

  test('history resets after clearing conversation', async ({ page }) => {
    // Send first message
    const input = visibleAgentInput(page)
    await input.fill('Hello')
    await visibleAgentSend(page).click()

    // Wait for response
    const firstResponse = visibleAiMessages(page).last()
    await expect(firstResponse).toBeVisible({ timeout: 5000 })

    // Clear conversation (click the + button)
    await page.getByTestId('ai-workspace-sidebar-new-chat').click()
    await page.waitForTimeout(300)

    // Messages should be cleared
    await expect(visibleAiMessages(page)).toHaveCount(0)

    // Send new message — should have no history
    await visibleAgentInput(page).fill('Fresh start')
    await visibleAgentSend(page).click()

    const freshResponse = visibleAiMessages(page).last()
    await expect(freshResponse).toBeVisible({ timeout: 5000 })
    await expect(freshResponse).toContainText('[mock-claude code]')
    await expect(freshResponse).toContainText('You said: "Fresh start"')
  })

  test('closing and reopening restores the titled chat and remains usable', async ({ page }) => {
    const input = visibleAgentInput(page)
    await input.fill('Keep this thread alive')
    await visibleAgentSend(page).click()

    const firstResponse = visibleAiMessages(page).last()
    await expect(firstResponse).toContainText('[mock-claude code]', { timeout: 5000 })

    await page.getByTitle('Close AI workspace').click()
    await expect(page.getByTestId('ai-workspace')).toHaveCount(0)

    await sendShortcut(page, 'L', ['Meta', 'Shift'])
    const panel = page.getByTestId('ai-panel')
    await expect(panel).toBeVisible({ timeout: 3_000 })
    await expect(page.getByTestId('ai-workspace')).toContainText('Keep Thread Alive')
    await expect(visibleAiMessages(page)).toHaveCount(0)

    await page.getByTestId('ai-workspace-sidebar-new-chat').focus()
    await expect(page.getByTestId('ai-workspace-sidebar-new-chat')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(visibleAiMessages(page)).toHaveCount(0)
  })
})
