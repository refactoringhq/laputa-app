import { test, expect, type Locator, type Page } from '@playwright/test'
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

function appendMalformedReloadEntry(entries: Array<Record<string, unknown>>) {
  return entries.concat({
    filename: 'phantom-from-reload.md',
    title: 'Phantom From Reload',
    aliases: [],
    outgoingLinks: [],
    relationships: {},
    properties: {},
    snippet: '',
  })
}

async function reloadVaultFromCommandPalette(page: Page): Promise<void> {
  await openCommandPalette(page)
  await executeCommand(page, 'Reload Vault')
  await expect(page.locator('input[placeholder="Type a command..."]')).not.toBeVisible()
}

async function openNoteFromList(noteList: Locator, title: string): Promise<void> {
  await noteList.getByText(title, { exact: true }).click()
}

async function expectAlphaProjectHeading(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Alpha Project', level: 1 })).toBeVisible({ timeout: 5_000 })
}

async function switchFromNoteBBackToAlpha(page: Page, noteList: Locator): Promise<void> {
  await openNoteFromList(noteList, 'Note B')
  await openNoteFromList(noteList, 'alpha-project')
  await expectAlphaProjectHeading(page)
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
    const scrubbedEntries = removeAlphaProjectStringMetadata(entries)
    await route.fulfill({
      response,
      json: requestUrl.searchParams.get('reload') === '1'
        ? appendMalformedReloadEntry(scrubbedEntries)
        : scrubbedEntries,
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

  await openNoteFromList(noteList, 'alpha-project')
  await expectAlphaProjectHeading(page)
  await switchFromNoteBBackToAlpha(page, noteList)

  expect(errors).toHaveLength(0)
})

test('note open after vault reload tolerates missing suggestion metadata', async ({ page }) => {
  const errors = collectMissingMetadataCrashes(page)
  const noteList = page.getByTestId('note-list-container')

  await reloadVaultFromCommandPalette(page)

  await expect(noteList.getByText('Phantom From Reload', { exact: true })).toHaveCount(0)
  await switchFromNoteBBackToAlpha(page, noteList)

  expect(errors).toHaveLength(0)
})
