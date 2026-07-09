import { test, expect } from '@playwright/test'
import { executeCommand, openCommandPalette } from './helpers'

test.describe('Contribute modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const openedUrls: string[] = []
      Object.defineProperty(window, '__tolariaOpenedUrls', {
        configurable: true,
        value: openedUrls,
      })
      window.open = ((url?: string | URL | undefined) => {
        openedUrls.push(String(url ?? ''))
        return null
      }) as typeof window.open

      const copiedBundles: string[] = []
      Object.defineProperty(window, '__tolariaCopiedBundles', {
        configurable: true,
        value: copiedBundles,
      })
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            copiedBundles.push(text)
          },
        },
      })
    })

    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-testid="sidebar-top-nav"]')).toBeVisible({ timeout: 10_000 })
  })

  test('Cmd+K opens Contribute, keyboard actions work, and Escape restores the opener @smoke', async ({ page }) => {
    await openCommandPalette(page)
    await executeCommand(page, 'Contribute')

    await expect(page.getByTestId('feedback-dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Contribute to Tolaria' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check out Refactoring' })).toBeFocused()

    await page.keyboard.press('Enter')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://refactoring.fm/?utm_source=tolaria&utm_medium=app&utm_campaign=refactoring')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open Codacy' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://www.codacy.com/?utm_source=tolaria&utm_medium=app&utm_campaign=refactoring')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open CodeScene' })).toBeFocused()
    await page.keyboard.press('Space')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://codescene.com/?utm_source=tolaria&utm_medium=app&utm_campaign=refactoring')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open CircleCI' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://circleci.com/?utm_source=tolaria&utm_medium=app&utm_campaign=refactoring')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open Unblocked' })).toBeFocused()
    await page.keyboard.press('Space')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://getunblocked.com/?utm_source=tolaria&utm_medium=app&utm_campaign=refactoring')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'how I develop Tolaria' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://refactoring.fm/p/introducing-the-tolaria-alliance')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open Product Board' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://tolaria.canny.io/')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open Discussions' })).toBeFocused()
    await page.keyboard.press('Space')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://github.com/refactoringhq/tolaria/discussions')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open PRs' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://github.com/refactoringhq/tolaria/pulls')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open Guide' })).toBeFocused()
    await page.keyboard.press('Space')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://github.com/refactoringhq/tolaria/blob/main/CONTRIBUTING.md')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Open Issues' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaOpenedUrls: string[] }).__tolariaOpenedUrls)).toContain('https://github.com/refactoringhq/tolaria/issues')

    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Copy Diagnostics' })).toBeFocused()
    await page.keyboard.press('Space')
    await expect.poll(async () => page.evaluate(() => (window as typeof window & { __tolariaCopiedBundles: string[] }).__tolariaCopiedBundles.length)).toBe(1)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('feedback-dialog')).not.toBeVisible()
    await expect(page.locator('input[placeholder="Type a command..."]')).toBeVisible()
    await expect(page.locator('input[placeholder="Type a command..."]')).toBeFocused()
  })
})
