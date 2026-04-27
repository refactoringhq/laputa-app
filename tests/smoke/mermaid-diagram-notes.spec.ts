import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

const FIRST_DIAGRAM = [
  '```mermaid',
  'flowchart LR',
  '  A[Draft] --> B[Saved]',
  '```',
].join('\n')
const UPDATED_FIRST_DIAGRAM = FIRST_DIAGRAM.replace('B[Saved]', 'C[Published]')
const SECOND_DIAGRAM = [
  '```mermaid',
  'sequenceDiagram',
  '  Alice->>Bob: Hello',
  '```',
].join('\n')
const INVALID_DIAGRAM = [
  '```mermaid',
  'not a diagram',
  '```',
].join('\n')

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
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

async function setRawEditorContent(page: Page, content: string): Promise<void> {
  await page.evaluate((nextContent) => {
    type CodeMirrorHost = Element & {
      cmTile?: {
        view?: {
          state: {
            doc: {
              length: number
            }
          }
          dispatch(update: {
            changes: {
              from: number
              to: number
              insert: string
            }
          }): void
        }
      }
    }

    const host = document.querySelector('.cm-content') as CodeMirrorHost | null
    const view = host?.cmTile?.view
    if (!view) return

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextContent },
    })
  }, content)
}

async function expectRenderedDiagramCount(page: Page, count: number): Promise<void> {
  await expect(page.locator('[data-testid="mermaid-diagram-viewport"] svg')).toHaveCount(count, { timeout: 15_000 })
}

function readNoteBFile(): string {
  return fs.readFileSync(path.join(tempVaultDir, 'note', 'note-b.md'), 'utf8')
}

test('Mermaid diagrams render, fall back, and round-trip through raw mode', async ({ page }) => {
  await openNote(page, 'Note B')
  await toggleRawMode(page, '.cm-content')

  const originalContent = await getRawEditorContent(page)
  const nextContent = `${originalContent.trimEnd()}

${FIRST_DIAGRAM}

${INVALID_DIAGRAM}

${SECOND_DIAGRAM}
`

  await setRawEditorContent(page, nextContent)
  await expect.poll(readNoteBFile).toContain(FIRST_DIAGRAM)

  await toggleRawMode(page, '.bn-editor')
  await expectRenderedDiagramCount(page, 2)
  await expect(page.locator('[data-testid="mermaid-diagram-error"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="mermaid-diagram-error"]')).toContainText('not a diagram')

  await toggleRawMode(page, '.cm-content')
  const rawAfterRichMode = await getRawEditorContent(page)
  expect(rawAfterRichMode).toContain(FIRST_DIAGRAM)
  expect(rawAfterRichMode).toContain(INVALID_DIAGRAM)
  expect(rawAfterRichMode).toContain(SECOND_DIAGRAM)

  await setRawEditorContent(page, rawAfterRichMode.replace(FIRST_DIAGRAM, UPDATED_FIRST_DIAGRAM))
  await expect.poll(readNoteBFile).toContain(UPDATED_FIRST_DIAGRAM)

  await toggleRawMode(page, '.bn-editor')
  await expectRenderedDiagramCount(page, 2)
  await expect(page.locator('[data-testid="mermaid-diagram-viewport"]').first()).toContainText('Published')

  await openNote(page, 'Note C')
  await openNote(page, 'Note B')
  await toggleRawMode(page, '.cm-content')

  const reopenedRaw = await getRawEditorContent(page)
  expect(reopenedRaw).toContain(UPDATED_FIRST_DIAGRAM)
  expect(reopenedRaw).toContain(INVALID_DIAGRAM)
  expect(reopenedRaw).toContain(SECOND_DIAGRAM)
})
