import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette, sendShortcut } from './helpers'

let tempVaultDir: string

function writeFixtureNote(vaultPath: string, filename: string, content: string): string {
  const notePath = path.join(vaultPath, filename)
  fs.writeFileSync(notePath, content, 'utf8')
  return notePath
}

async function openNoteViaQuickOpen(page: Page, query: string): Promise<void> {
  await page.locator('body').click()
  await sendShortcut(page, 'p', ['Control'])
  const searchInput = page.locator('input[placeholder="Search notes..."]')
  await expect(searchInput).toBeVisible()
  await searchInput.fill(query)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(new RegExp(query, 'i'), { timeout: 5_000 })
}

test.describe('Type-derived instance properties', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    writeFixtureNote(
      tempVaultDir,
      'book.md',
      '---\ntype: Type\nstart date:\nRating: 5\nMentor: [[person/alice]]\n---\n# Book\n',
    )
    writeFixtureNote(
      tempVaultDir,
      'dune.md',
      '---\ntype: Book\n---\n# Dune\n\nExisting instance without type schema fields.\n',
    )
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await page.setViewportSize({ width: 1600, height: 900 })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('type schema placeholders stay visible and valued defaults seed new instances @smoke', async ({ page }) => {
    const existingBookPath = path.join(tempVaultDir, 'dune.md')
    await openNoteViaQuickOpen(page, 'Dune')
    await sendShortcut(page, 'i', ['Control', 'Shift'])

    const startDatePlaceholder = page.getByTestId('type-derived-property').filter({ hasText: 'Start date' })
    await expect(startDatePlaceholder).toBeVisible()
    await expect(startDatePlaceholder.getByText('Start date')).toHaveClass(/text-muted-foreground\/40/)

    const mentorPlaceholder = page.getByTestId('type-derived-relationship').filter({ hasText: 'Mentor' })
    await expect(mentorPlaceholder).toBeVisible()
    await expect(mentorPlaceholder.getByText('Mentor')).toHaveClass(/text-muted-foreground\/40/)

    await startDatePlaceholder.click()
    const startDateRow = page.getByTestId('editable-property').filter({ hasText: 'Start date' })
    await startDateRow.locator('input').fill('2026-05-04')
    await startDateRow.locator('input').blur()
    await expect.poll(() => fs.readFileSync(existingBookPath, 'utf8')).toContain('start date: "2026-05-04"')

    await page.locator('aside').getByText('Books', { exact: true }).first().click()
    await page.locator('[title="Create new note"]').first().click()
    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-book-\d+/i, { timeout: 5_000 })

    await openCommandPalette(page)
    await executeCommand(page, 'Toggle Raw')
    const rawEditor = page.locator('.cm-content')
    await expect(rawEditor).toContainText('type: Book')
    await expect(rawEditor).toContainText('Rating: 5')
    await expect(rawEditor).toContainText('Mentor: "[[person/alice]]"')
    await expect(rawEditor).not.toContainText('start date:')
  })
})
