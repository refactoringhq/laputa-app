import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

const WHITEBOARD_NOTE = [
  '# Whiteboard Embed',
  '',
  'Context before the board.',
  '',
  '```tldraw id="planning-map"',
  '{}',
  '```',
  '',
  'Context after the board.',
  '',
].join('\n')

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  fs.writeFileSync(path.join(tempVaultDir, 'note', 'whiteboard-embed.md'), WHITEBOARD_NOTE)
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string): Promise<void> {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function toggleRawMode(page: Page, visibleSelector: '.bn-editor' | '.cm-content'): Promise<void> {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator(visibleSelector)).toBeVisible({ timeout: 5_000 })
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

    const host = document.querySelector('.cm-content') as CodeMirrorHost | null
    return host?.cmTile?.view?.state.doc.toString() ?? host?.textContent ?? ''
  })
}

test('tldraw whiteboard fences render as embedded canvases and remain Markdown-durable', async ({ page }) => {
  await openNote(page, 'Whiteboard Embed')

  await expect(page.locator('.tldraw-whiteboard')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.tldraw-whiteboard .tl-container')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.bn-editor')).toContainText('Context before the board.')
  await expect(page.locator('.bn-editor')).toContainText('Context after the board.')

  await toggleRawMode(page, '.cm-content')
  const rawAfterRichMode = await getRawEditorContent(page)

  expect(rawAfterRichMode).toContain('```tldraw id="planning-map" height="520"')
  expect(rawAfterRichMode).toContain('{}')
  expect(rawAfterRichMode).not.toContain('@@TOLARIA_TLDRAW')
})
