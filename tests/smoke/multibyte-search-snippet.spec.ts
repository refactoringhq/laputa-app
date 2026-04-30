import { expect, test } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

async function showNoteListSearch(page: import('@playwright/test').Page) {
  await page.getByTitle('Search notes').click()
  await expect(page.getByPlaceholder('Search notes...')).toBeVisible()
}

test.describe('Multibyte note-list search', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    const noteDir = path.join(tempVaultDir, 'note')
    fs.mkdirSync(noteDir, { recursive: true })
    fs.writeFileSync(
      path.join(noteDir, 'multibyte-search-boundary.md'),
      [
        '---',
        'Is A: Note',
        '---',
        '# Multibyte Search Boundary',
        '',
        `${'한'.repeat(21)}aneedle after multibyte prefix`,
      ].join('\n'),
      'utf-8',
    )
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('searching content near Korean text keeps the result openable @smoke', async ({ page }) => {
    await showNoteListSearch(page)

    const noteList = page.getByTestId('note-list-container')
    const searchInput = page.getByPlaceholder('Search notes...')
    await searchInput.fill('needle')

    await expect(page.getByTestId('note-list-search-loading')).toHaveCount(0)
    await expect(noteList.getByText('Multibyte Search Boundary', { exact: true })).toBeVisible()

    await noteList.getByText('Multibyte Search Boundary', { exact: true }).click()
    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(
      'multibyte-search-boundary',
    )
  })
})
