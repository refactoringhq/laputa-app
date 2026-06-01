import { test, expect, type Page } from '@playwright/test'
import { executeCommand, openCommandPalette } from './helpers'

type Handler = (args?: Record<string, unknown>) => unknown
type RemoteArgs = {
  request?: {
    vaultPath?: string
    remoteUrl?: string
  }
  vaultPath?: string
  remoteUrl?: string
}
type BrowserWindow = Window &
  typeof globalThis & {
    __mockHandlers?: Record<string, Handler>
    __remoteConnected?: boolean
    __addRemoteCalls?: string[]
  }

function installRemoteMocksScript() {
  const browserWindow = window as BrowserWindow
  browserWindow.__remoteConnected = false
  browserWindow.__addRemoteCalls = []

  const applyRemoteMockOverrides = (handlers?: Record<string, Handler> | null) => {
    if (!handlers) return handlers ?? null

    handlers.git_remote_status = () => ({
      branch: 'main',
      ahead: 0,
      behind: 0,
      hasRemote: browserWindow.__remoteConnected ?? false,
    })

    handlers.git_add_remote = (args?: RemoteArgs) => {
      const request = args?.request ?? args ?? {}
      const remoteUrl = request.remoteUrl ?? ''
      browserWindow.__addRemoteCalls = [
        ...(browserWindow.__addRemoteCalls ?? []),
        remoteUrl,
      ]

      if (remoteUrl === 'https://example.com/safe.git') {
        browserWindow.__remoteConnected = true
        return {
          status: 'connected',
          message: 'Remote connected. This vault now tracks origin/main.',
        }
      }

      return {
        status: 'incompatible_history',
        message: 'This repository has unrelated history.',
      }
    }

    return handlers
  }

  let ref = applyRemoteMockOverrides(browserWindow.__mockHandlers) ?? null
  Object.defineProperty(browserWindow, '__mockHandlers', {
    configurable: true,
    set(value) {
      ref = applyRemoteMockOverrides(value as Record<string, Handler> | undefined) ?? null
    },
    get() {
      return applyRemoteMockOverrides(ref) ?? ref
    },
  })
}

async function installRemoteMocks(page: Page): Promise<void> {
  await page.addInitScript(installRemoteMocksScript)
}

async function openAddRemoteFromStatusChip(page: Page): Promise<void> {
  const statusChip = page.getByTestId('status-no-remote')
  await expect(statusChip).toContainText('No remote')
  await statusChip.focus()
  await expect(statusChip).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('add-remote-modal')).toBeVisible()
  await expect(page.getByTestId('add-remote-url')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('add-remote-modal')).toHaveCount(0)
}

async function connectRemoteFromCommandPalette(page: Page, remoteUrl: string): Promise<void> {
  await openCommandPalette(page)
  await executeCommand(page, 'Add Remote to Current Vault')

  await expect(page.getByTestId('add-remote-modal')).toBeVisible()
  await expect(page.getByTestId('add-remote-url')).toBeFocused()

  await page.keyboard.type(remoteUrl)
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('add-remote-submit')).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByTestId('status-no-remote')).toHaveCount(0)
  await expect
    .poll(async () =>
      page.evaluate(
        () => (window as Window & { __addRemoteCalls?: string[] }).__addRemoteCalls?.length ?? 0,
      ),
    )
    .toBe(1)
}

async function assertCommitPushDialogStillOpens(page: Page): Promise<void> {
  await openCommandPalette(page)
  await executeCommand(page, 'Commit & Push')

  await expect(page.getByRole('heading', { name: 'Commit & Push' })).toBeVisible()
  await expect(
    page.getByText(
      'Review changed files and enter a commit message before committing and pushing.',
    ),
  ).toBeVisible()
}

test('keyboard-only add remote flow connects a local-only vault @smoke', async ({
  page,
}) => {
  await installRemoteMocks(page)

  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await openAddRemoteFromStatusChip(page)
  await connectRemoteFromCommandPalette(page, 'https://example.com/safe.git')
  await assertCommitPushDialogStillOpens(page)
})
