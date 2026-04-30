import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

function isMissingStringMetadataCrash(message: string): boolean {
  return (
    message.includes("Cannot read properties of undefined (reading 'replace')") ||
    message.includes('undefined is not an object') ||
    /undefined.*\.replace|\.replace.*undefined/.test(message)
  )
}

function collectMissingMetadataCrashes(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    if (isMissingStringMetadataCrash(error.message)) errors.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && isMissingStringMetadataCrash(message.text())) {
      errors.push(message.text())
    }
  })
  return errors
}

function removeAlphaProjectStringMetadata(entries: Array<Record<string, unknown>>) {
  return entries.map((entry) => {
    const entryPath = typeof entry.path === 'string' ? entry.path : ''
    const title = typeof entry.title === 'string' ? entry.title : ''
    if (title !== 'Alpha Project' && !entryPath.endsWith('/alpha-project.md')) return entry
    return {
      ...entry,
      title: undefined,
      filename: undefined,
      aliases: undefined,
      outgoingLinks: undefined,
      relationships: undefined,
      properties: undefined,
      snippet: undefined,
    }
  })
}

async function reloadVaultFromCommandPalette(page: Page): Promise<void> {
  await openCommandPalette(page)
  await executeCommand(page, 'Reload Vault')
  await expect(page.locator('input[placeholder="Type a command..."]')).not.toBeVisible()
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url())
    if (!requestUrl.pathname.endsWith('/api/vault/list')) {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const entries = await response.json() as Array<Record<string, unknown>>
    await route.fulfill({
      response,
      json: removeAlphaProjectStringMetadata(entries),
    })
  })
  await openFixtureVaultDesktopHarness(page, tempVaultDir, {
    expectedReadyTitle: 'alpha-project',
  })
  await page.setViewportSize({ width: 1180, height: 760 })
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke note open tolerates missing string metadata from the vault scan', async ({ page }) => {
  const errors = collectMissingMetadataCrashes(page)
  const noteList = page.getByTestId('note-list-container')

  await noteList.getByText('alpha-project', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Alpha Project', level: 1 })).toBeVisible({ timeout: 5_000 })

  await noteList.getByText('Note B', { exact: true }).click()
  await noteList.getByText('alpha-project', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Alpha Project', level: 1 })).toBeVisible({ timeout: 5_000 })

  expect(errors).toHaveLength(0)
})

test('note open after vault reload tolerates missing suggestion metadata', async ({ page }) => {
  const errors = collectMissingMetadataCrashes(page)
  const noteList = page.getByTestId('note-list-container')

  await reloadVaultFromCommandPalette(page)

  await noteList.getByText('Note B', { exact: true }).click()
  await noteList.getByText('alpha-project', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Alpha Project', level: 1 })).toBeVisible({ timeout: 5_000 })

  expect(errors).toHaveLength(0)
})
