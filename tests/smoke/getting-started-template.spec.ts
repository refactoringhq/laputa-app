import { test, expect } from '@playwright/test'

test('Getting Started template shows inline retry on clone failure and opens after retry @smoke', async ({ page }) => {
  const clonedPath = '/Users/mock/Documents/Getting Started'

  await page.addInitScript(() => {
    localStorage.clear()

    let ref: Record<string, unknown> | null = null
    let cloneAttempts = 0
    let cloneSucceeded = false

    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      set(value) {
        ref = value as Record<string, unknown>
        ref.load_vault_list = () => ({
          vaults: [],
          active_vault: null,
          hidden_defaults: [],
        })
        ref.get_default_vault_path = () => '/Users/mock/Documents/Getting Started'
        ref.check_vault_exists = (args?: { path?: string }) => args?.path === '/Users/mock/Documents/Getting Started'
          ? cloneSucceeded
          : false
        ref.create_getting_started_vault = (args: { targetPath?: string | null }) => {
          cloneAttempts += 1
          if (cloneAttempts === 1) {
            throw 'git clone failed: fatal: unable to access'
          }
          if (args.targetPath !== '/Users/mock/Documents/Getting Started') {
            throw new Error(`Unexpected Getting Started target: ${args.targetPath}`)
          }
          cloneSucceeded = true
          return args.targetPath
        }
      },
      get() {
        return ref
      },
    })

    Object.defineProperty(window, 'prompt', {
      configurable: true,
      value: () => '/Users/mock/Documents',
    })
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('welcome-screen')).toBeVisible()

  await page.getByTestId('welcome-create-vault').click()

  await expect(page.getByTestId('welcome-error')).toContainText(
    'Could not download Getting Started vault: git clone failed: fatal: unable to access',
  )
  await expect(page.getByTestId('welcome-retry-template')).toBeVisible()

  await page.getByTestId('welcome-retry-template').click()

  await expect(page.getByTestId('welcome-screen')).not.toBeVisible()
  await expect(page.getByText(`Getting Started vault cloned and opened at ${clonedPath}`)).toBeVisible()
  await expect(page.getByTestId('claude-onboarding-screen')).toBeVisible()
  await expect(page.getByText('Claude Code not detected')).toBeVisible()
  await page.getByTestId('claude-onboarding-continue').click()
  await expect(page.locator('[data-testid="note-list-container"]')).toBeVisible()
})
