import { test, expect } from '@playwright/test'
import { openCommandPalette, findCommand } from './helpers'

test('vault guidance restore command recovers missing managed guidance', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    Object.defineProperty(window, 'prompt', {
      configurable: true,
      value: () => '/Users/luca/Laputa',
    })

    let ref: Record<string, unknown> | null = null
    let guidanceStatus = {
      agents_state: 'missing',
      claude_state: 'managed',
      can_restore: true,
    }

    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      set(value) {
        ref = value as Record<string, unknown>

        const originalGetSettings = ref.get_settings as () => Record<string, unknown>
        ref.get_settings = () => ({
          ...originalGetSettings(),
          default_ai_agent: 'codex',
        })

        ref.get_default_vault_path = () => '/Users/luca/Laputa'
        ref.check_vault_exists = (args: { path: string }) => args.path === '/Users/luca/Laputa'
        ref.get_ai_agents_status = () => ({
          claude_code: { installed: false, version: null },
          codex: { installed: true, version: '1.2.3' },
          opencode: { installed: false, version: null },
        })
        ref.get_vault_ai_guidance_status = () => ({ ...guidanceStatus })
        ref.restore_vault_ai_guidance = () => {
          guidanceStatus = {
            agents_state: 'managed',
            claude_state: 'managed',
            can_restore: false,
          }
          return { ...guidanceStatus }
        }
      },
      get() {
        return ref
      },
    })
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('welcome-screen')).toBeVisible()
  await page.getByRole('button', { name: /Open existing vault/i }).click()
  await expect(page.getByText('Claude Code not detected')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 5_000 })

  const aiBadge = page.getByTestId('status-ai-agents')
  await expect(aiBadge).toHaveAttribute('title', /Tolaria guidance missing or broken/)

  await openCommandPalette(page)
  expect(await findCommand(page, 'Restore Tolaria AI Guidance')).toBe(true)
  await page.keyboard.press('Enter')

  await expect(page.getByText('Tolaria AI guidance restored')).toBeVisible()

  await aiBadge.click()
  await expect(page.getByTestId('status-ai-guidance-summary')).toHaveText('Tolaria guidance ready')
  await expect(page.getByTestId('status-ai-guidance-restore')).toHaveCount(0)
  await page.keyboard.press('Escape')

  await openCommandPalette(page)
  expect(await findCommand(page, 'Restore Tolaria AI Guidance')).toBe(false)
})
