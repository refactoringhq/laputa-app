import { expect, test, type Page } from '@playwright/test'
import { executeCommand, openCommandPalette } from './helpers'
import { seedAutoGitSavedChange } from './testBridge'

type MockHandler = (args?: Record<string, unknown>) => unknown

function installAutoGitMocks() {
  type BrowserWindow = Window & typeof globalThis & {
    __getDirtyPathCount?: () => number
    __gitCommitAttempts?: number
    __gitCommitMessages?: string[]
    __gitPushCalls?: number
    __mockHandlers?: Record<string, MockHandler>
    __setMockAppActive?: (active: boolean) => void
    __setMockGitCommitFailure?: (message: string | null) => void
  }

  const browserWindow = window as BrowserWindow
  const dirtyPaths = new Set<string>()
  let appActive = true
  let ahead = 0
  let gitCommitFailure: string | null = null

  const createModifiedFiles = () => [...dirtyPaths].map((path) => ({
    path,
    relativePath: path.split('/').pop() ?? path,
    status: 'modified',
  }))

  const isPatched = (handlers?: Record<string, MockHandler> | null) =>
    !handlers || (handlers as Record<string, unknown>).__autogitPatched === true

  const patchSaveNoteContent = (handlers: Record<string, MockHandler>) => {
    const originalSaveNoteContent = handlers.save_note_content
    handlers.save_note_content = (args?: Record<string, unknown>) => {
      const path = typeof args?.path === 'string' ? args.path : null
      if (path) dirtyPaths.add(path)
      return originalSaveNoteContent?.(args)
    }
  }

  const patchGitHandlers = (handlers: Record<string, MockHandler>) => {
    handlers.get_modified_files = () => createModifiedFiles()

    handlers.git_commit = (args?: Record<string, unknown>) => {
      browserWindow.__gitCommitAttempts = (browserWindow.__gitCommitAttempts ?? 0) + 1
      if (gitCommitFailure) {
        throw new Error(gitCommitFailure)
      }

      const message = typeof args?.message === 'string' ? args.message : ''
      browserWindow.__gitCommitMessages?.push(message)
      dirtyPaths.clear()
      ahead = 1
      return `[main abc1234] ${message}`
    }

    handlers.git_push = () => {
      browserWindow.__gitPushCalls = (browserWindow.__gitPushCalls ?? 0) + 1
      ahead = 0
      return { status: 'ok', message: 'Pushed to remote' }
    }

    handlers.git_remote_status = () => ({
      branch: 'main',
      ahead,
      behind: 0,
      hasRemote: true,
    })
  }

  const markPatched = (handlers: Record<string, MockHandler>) => {
    Object.defineProperty(handlers, '__autogitPatched', {
      configurable: true,
      enumerable: false,
      value: true,
    })
  }

  const patchHandlers = (handlers?: Record<string, MockHandler> | null) => {
    if (isPatched(handlers)) {
      return handlers ?? null
    }

    patchSaveNoteContent(handlers)
    patchGitHandlers(handlers)
    markPatched(handlers)
    return handlers
  }

  document.hasFocus = () => appActive
  browserWindow.__setMockAppActive = (active: boolean) => {
    appActive = active
  }
  browserWindow.__setMockGitCommitFailure = (message: string | null) => {
    gitCommitFailure = message
  }
  browserWindow.__getDirtyPathCount = () => dirtyPaths.size
  browserWindow.__gitCommitAttempts = 0
  browserWindow.__gitCommitMessages = []
  browserWindow.__gitPushCalls = 0

  let ref = patchHandlers(browserWindow.__mockHandlers) ?? null
  Object.defineProperty(browserWindow, '__mockHandlers', {
    configurable: true,
    get() {
      return patchHandlers(ref) ?? ref
    },
    set(value) {
      ref = patchHandlers(value as Record<string, MockHandler> | undefined) ?? null
    },
  })
}

async function openFirstNote(page: Page) {
  const noteList = page.locator('[data-testid="note-list-container"]')
  await noteList.waitFor({ timeout: 5_000 })
  await noteList.locator('.cursor-pointer').first().click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function openAutoGitSettings(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Open Settings')

  const settingsPanel = page.getByTestId('settings-panel')
  await expect(settingsPanel).toBeVisible({ timeout: 5_000 })

  const autoGitSwitch = settingsPanel.getByTestId('settings-autogit-enabled')
  await expect(autoGitSwitch).toBeEnabled({ timeout: 5_000 })
  await autoGitSwitch.click({ force: true })
  await page.getByTestId('settings-autogit-idle-threshold').fill('2')
  await page.getByTestId('settings-autogit-inactive-threshold').fill('2')
  await page.getByTestId('settings-save').click()
  await expect(settingsPanel).not.toBeVisible({ timeout: 5_000 })
}

async function expectDirtyPathCount(page: Page, expectedCount: number) {
  await expect.poll(async () =>
    page.evaluate(() => (window as Window & { __getDirtyPathCount?: () => number }).__getDirtyPathCount?.() ?? 0),
  ).toBe(expectedCount)
}

async function expectCommitMessageCount(page: Page, expectedCount: number) {
  await expect.poll(async () =>
    page.evaluate(() => (window as Window & { __gitCommitMessages?: string[] }).__gitCommitMessages?.length ?? 0),
  ).toBe(expectedCount)
}

async function expectCommitAttemptCount(page: Page, expectedCount: number) {
  await expect.poll(async () =>
    page.evaluate(() => (window as Window & { __gitCommitAttempts?: number }).__gitCommitAttempts ?? 0),
  ).toBe(expectedCount)
}

async function expectCommitMessage(page: Page, index: number, expectedMessage: string) {
  await expect.poll(async () =>
    page.evaluate(
      ({ targetIndex }) => (window as Window & { __gitCommitMessages?: string[] }).__gitCommitMessages?.[targetIndex] ?? '',
      { targetIndex: index },
    ),
  ).toBe(expectedMessage)
}

async function expectPushCount(page: Page, expectedCount: number) {
  await expect.poll(async () =>
    page.evaluate(() => (window as Window & { __gitPushCalls?: number }).__gitPushCalls ?? 0),
  ).toBe(expectedCount)
}

async function expectCheckpoint(page: Page, count: number) {
  await expectCommitMessageCount(page, count)
  await expectCommitMessage(page, count - 1, 'Updated 1 note')
  await expectPushCount(page, count)
}

async function seedSavedChange(page: Page) {
  await seedAutoGitSavedChange(page)
  await expectDirtyPathCount(page, 1)
}

async function setMockAppActive(page: Page, active: boolean) {
  await page.evaluate((nextActive) => {
    ;(window as Window & { __setMockAppActive?: (active: boolean) => void }).__setMockAppActive?.(nextActive)
    window.dispatchEvent(new Event(nextActive ? 'focus' : 'blur'))
  }, active)
}

async function setMockGitCommitFailure(page: Page, message: string | null) {
  await page.evaluate((failureMessage) => {
    ;(window as Window & {
      __setMockGitCommitFailure?: (message: string | null) => void
    }).__setMockGitCommitFailure?.(failureMessage)
  }, message)
}

async function triggerQuickCommit(page: Page) {
  const commitButton = page.getByTestId('status-commit-push')
  await expect(commitButton).toBeEnabled({ timeout: 5_000 })
  await commitButton.click()
}

test('@smoke AutoGit checkpoints on idle, and the bottom bar reuses the same message', async ({ page }) => {
  await page.addInitScript(installAutoGitMocks)
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await openAutoGitSettings(page)
  await openFirstNote(page)

  await seedSavedChange(page)
  await expectCheckpoint(page, 1)

  await seedSavedChange(page)
  await triggerQuickCommit(page)
  await expectCheckpoint(page, 2)

  await expect(page.locator('.fixed.bottom-8')).toContainText('Committed and pushed', { timeout: 5_000 })
})

test('AutoGit checkpoints when the app is inactive', async ({ page }) => {
  await page.addInitScript(installAutoGitMocks)
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await openAutoGitSettings(page)
  await openFirstNote(page)
  await setMockAppActive(page, false)

  await seedSavedChange(page)
  await expectCheckpoint(page, 1)
})

test('AutoGit does not retry a failed checkpoint until the next saved change', async ({ page }) => {
  await page.addInitScript(installAutoGitMocks)
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await openAutoGitSettings(page)
  await openFirstNote(page)
  await setMockGitCommitFailure(page, 'Author identity unknown')

  await seedSavedChange(page)
  await expectCommitAttemptCount(page, 1)
  await expectDirtyPathCount(page, 1)
  await expect(page.locator('.fixed.bottom-8')).toContainText('Set a Git author before AutoGit can commit', { timeout: 5_000 })

  await page.waitForTimeout(3_500)
  await expectCommitAttemptCount(page, 1)

  await seedSavedChange(page)
  await expectCommitAttemptCount(page, 2)
})
