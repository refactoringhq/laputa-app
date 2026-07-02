import { expect, test } from '@playwright/test'
import { executeCommand, openCommandPalette, sendShortcut } from './helpers'

test.setTimeout(60_000)

test('command palette generates an editable commit message from the current diff', async ({ page }) => {
  await page.goto('/', { timeout: 45_000, waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 20_000 })

  await openCommandPalette(page)
  await executeCommand(page, 'Generate Commit Message from Diff')

  const messageInput = page.locator('textarea[placeholder="Commit message..."]')
  await expect(page.getByRole('heading', { name: 'Commit & Push' })).toBeVisible()
  await expect(messageInput).toHaveValue('Update 4 notes', { timeout: 5_000 })
  await expect(messageInput).toBeFocused()
  await expect(page.getByRole('button', { name: 'Commit & Push' })).toBeEnabled()

  await sendShortcut(page, 'a', ['Control'])
  await page.keyboard.type('Update generated commit draft')
  await sendShortcut(page, 'Enter', ['Control'])

  await expect(page.locator('.fixed.bottom-8')).toContainText('Committed and pushed', { timeout: 5_000 })
})
