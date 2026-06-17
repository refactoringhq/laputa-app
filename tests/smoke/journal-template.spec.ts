import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { openCommandPalette, executeCommand } from './helpers'

let tempVaultDir: string

function writeFixtureNote(vaultPath: string, filename: string, content: string): string {
  const notePath = path.join(vaultPath, filename)
  fs.writeFileSync(notePath, content, 'utf8')
  return notePath
}

test.describe('Journal template substitution and date filenames', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    writeFixtureNote(
      tempVaultDir,
      'journal.md',
      '---\ntype: Type\nicon: notebook\ncolor: teal\ntemplate: "# {{date:EEEE, MMMM d}}\\n\\n"\n_filename_template: "{{date:yyyy-MM-dd}}"\n_subfolder_path: "journals/{{date:yyyy}}/{{date:MM}}"\n---\n# Journal\n',
    )
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await page.setViewportSize({ width: 1600, height: 900 })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('creates a date-named journal with a substituted body and opens the same note on repeat', async ({ page }) => {
    // First creation: produces today's date-named file with substituted heading.
    await page.locator('aside').getByText('Journals', { exact: true }).first().click()
    await page.locator('[title="Create new note"]').first().click()

    const todayIso = new Date().toISOString().slice(0, 10)
    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(todayIso, { timeout: 5_000 })

    await openCommandPalette(page)
    await executeCommand(page, 'Toggle Raw')
    const rawEditor = page.locator('.cm-content')
    await expect(rawEditor).toContainText('type: Journal')
    await expect(rawEditor).toContainText('# ' + weekdayLongMonthDay(new Date()))

    // Second creation on the same date: opens the existing note (no duplicate, no suffix).
    await page.locator('aside').getByText('Journals', { exact: true }).first().click()
    await page.locator('[title="Create new note"]').first().click()
    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(todayIso, { timeout: 5_000 })

    // The journal note is filed in the resolved nested folder, not the vault root,
    // and only one exists on disk (second creation opened the existing note).
    const now = new Date()
    const year = String(now.getFullYear())
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const journalDir = path.join(tempVaultDir, 'journals', year, month)
    const journalFiles = fs.readdirSync(journalDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    expect(journalFiles).toHaveLength(1)

    const rootFiles = fs.readdirSync(tempVaultDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
    expect(rootFiles).toHaveLength(0)
  })
})

function weekdayLongMonthDay(now: Date): string {
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${weekdays[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`
}
