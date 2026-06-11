import { test, expect } from '@playwright/test'
import { openCommandPalette, executeCommand } from './helpers'

test.describe('Sync error UX — actionable push error messages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForFunction(() => {
      const handlers = Reflect.get(globalThis, '__mockHandlers')
      return Boolean(handlers && typeof handlers === 'object' && Reflect.get(handlers, 'git_push'))
    })
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible()
  })

  test('rejected push shows actionable "Pull first" message in toast', async ({ page }) => {
    // Override git_push mock to return a rejected result
    await page.evaluate(() => {
      const handlers = Reflect.get(globalThis, '__mockHandlers')
      if (!handlers || typeof handlers !== 'object') throw new Error('Mock handlers were not installed')
      Reflect.set(handlers, 'git_push', () => ({
        status: 'rejected',
        message: 'Push rejected: remote has new commits. Pull first, then push.',
      }))
    })

    // Open commit dialog via command palette
    await openCommandPalette(page)
    await executeCommand(page, 'Commit & Push')

    // Wait for the CommitDialog textarea
    const textarea = page.locator('textarea[placeholder="Commit message..."]')
    await textarea.waitFor({ timeout: 5000 })
    await textarea.fill('test commit')

    // Click the "Commit & Push" button in the dialog
    const commitButton = page.getByRole('button', { name: 'Commit & Push' })
    await commitButton.click()

    // Verify the toast shows the actionable rejection message
    const toast = page.locator('.fixed.bottom-8')
    await expect(toast).toContainText('Pull first', { timeout: 5000 })
  })

  test('auth error push shows authentication message in toast', async ({ page }) => {
    await page.evaluate(() => {
      const handlers = Reflect.get(globalThis, '__mockHandlers')
      if (!handlers || typeof handlers !== 'object') throw new Error('Mock handlers were not installed')
      Reflect.set(handlers, 'git_push', () => ({
        status: 'auth_error',
        message: 'Push failed: authentication error. Check your credentials.',
      }))
    })

    await openCommandPalette(page)
    await executeCommand(page, 'Commit & Push')

    const textarea = page.locator('textarea[placeholder="Commit message..."]')
    await textarea.waitFor({ timeout: 5000 })
    await textarea.fill('test commit')

    await page.getByRole('button', { name: 'Commit & Push' }).click()

    const toast = page.locator('.fixed.bottom-8')
    await expect(toast).toContainText('authentication error', { timeout: 5000 })
  })

  test('successful push shows normal success message', async ({ page }) => {
    await openCommandPalette(page)
    await executeCommand(page, 'Commit & Push')

    const textarea = page.locator('textarea[placeholder="Commit message..."]')
    await textarea.waitFor({ timeout: 5000 })
    await textarea.fill('test commit')

    await page.getByRole('button', { name: 'Commit & Push' }).click()

    const toast = page.locator('.fixed.bottom-8')
    await expect(toast).toContainText('Committed and pushed', { timeout: 5000 })
  })
})
