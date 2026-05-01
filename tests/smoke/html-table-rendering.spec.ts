import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'

const NOTE_FILENAME = 'html-table-note.md'
const NOTE_TITLE = 'Html Table Note'

const NOTE_CONTENT = `---
Is A: Note
---

# ${NOTE_TITLE}

## Kopfteil der Nachricht

<table>
  <thead>
    <tr>
      <th>Bezeichnung</th>
      <th>M/K</th>
      <th>Format</th>
      <th>Anmerkung</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Dokumentennummer</td>
      <td>M</td>
      <td>an..35</td>
      <td>eindeutige Identifikation der Nachricht</td>
    </tr>
    <tr>
      <td>Dokumentendatum</td>
      <td>M</td>
      <td>n8</td>
      <td>YYYYMMDD</td>
    </tr>
  </tbody>
</table>
`

let tempVaultDir: string

function trackUnexpectedErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('ws://localhost:9711')) return
    errors.push(text)
  })
  return errors
}

function seedHtmlTableNote(vaultDir: string): void {
  fs.writeFileSync(path.join(vaultDir, 'note', NOTE_FILENAME), NOTE_CONTENT, 'utf8')
}

test.describe('HTML <table> rendering (issue #452)', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page
    testInfo.setTimeout(60_000)
    tempVaultDir = createFixtureVaultCopy()
    seedHtmlTableNote(tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('renders an HTML <table> embedded in markdown as a BlockNote table', async ({ page }) => {
    const errors = trackUnexpectedErrors(page)

    await openFixtureVaultTauri(page, tempVaultDir)
    await page.getByText(NOTE_TITLE, { exact: true }).first().click()

    await expect(page.locator('.bn-editor table')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.bn-editor table')).toHaveCount(1)

    const editor = page.locator('.bn-editor')
    await expect(editor).toContainText('Bezeichnung')
    await expect(editor).toContainText('M/K')
    await expect(editor).toContainText('Format')
    await expect(editor).toContainText('Anmerkung')
    await expect(editor).toContainText('Dokumentennummer')
    await expect(editor).toContainText('Dokumentendatum')
    await expect(editor).toContainText('eindeutige Identifikation der Nachricht')

    expect(errors).toEqual([])
  })
})
