import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

const pastedNoteSource = [
  '---',
  'title: Pasted Toggle',
  '---',
  'First pasted line with punctuation: a*b [brackets].',
  'Second pasted line from an external editor.',
  'Third pasted line should stay adjacent.',
  '',
].join('\n')

async function openNote(page: Page, title: string) {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function openRawMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 })
}

async function openBlockNoteMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function getRawEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    type CodeMirrorHost = Element & {
      cmTile?: {
        view?: {
          state: {
            doc: {
              toString(): string
            }
          }
        }
      }
    }

    const el = document.querySelector('.cm-content')
    if (!el) return ''
    const view = (el as CodeMirrorHost).cmTile?.view
    if (view) return view.state.doc.toString() as string
    return el.textContent ?? ''
  })
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  fs.writeFileSync(path.join(tempVaultDir, 'Pasted Toggle.md'), pastedNoteSource, 'utf8')
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('pasted multiline note source stays unchanged through raw and visual view toggles', async ({ page }) => {
  await openNote(page, 'Pasted Toggle')

  await openRawMode(page)
  await expect.poll(() => getRawEditorContent(page)).toBe(pastedNoteSource)

  await openBlockNoteMode(page)
  await openRawMode(page)

  const rawAfterRoundTrip = await getRawEditorContent(page)
  expect(rawAfterRoundTrip).toBe(pastedNoteSource)
  expect(rawAfterRoundTrip).not.toContain('\\\\\n')
  expect(rawAfterRoundTrip).not.toMatch(/\n{3,}/)
})
