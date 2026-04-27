import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette, sendShortcut } from './helpers'

const CODE_COPY_NOTE_RELATIVE_PATH = path.join('note', 'fenced-code-copy.md')
const CODE_COPY_NOTE_TITLE = 'Fenced Code Copy'
const JSON_SNIPPET = '{\n  "id": "Demo",\n  "enabled": true\n}'
const TYPESCRIPT_SNIPPET = 'const answer = 42\nconsole.log(answer)'
const RICH_CODE_SELECTOR = '.bn-block-content[data-content-type="codeBlock"] pre code'

function writeCodeCopyFixtureNote(tempVaultDir: string) {
  const notePath = path.join(tempVaultDir, CODE_COPY_NOTE_RELATIVE_PATH)
  fs.mkdirSync(path.dirname(notePath), { recursive: true })
  fs.writeFileSync(notePath, `---
Is A: Note
Status: Active
---

# ${CODE_COPY_NOTE_TITLE}

Copy this JSON exactly:

\`\`\`json
${JSON_SNIPPET}
\`\`\`

Copy this TypeScript exactly:

\`\`\`ts
${TYPESCRIPT_SNIPPET}
\`\`\`
`)
}

async function clearClipboard(page: Page) {
  await page.evaluate(() => navigator.clipboard.writeText(''))
}

async function readClipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText())
}

async function copySelectedText(page: Page) {
  await clearClipboard(page)
  await sendShortcut(page, 'c', ['Control'])
  return readClipboard(page)
}

async function selectRichCodeBlock(page: Page, blockIndex: number) {
  await page.locator(RICH_CODE_SELECTOR).nth(blockIndex).waitFor({ timeout: 10_000 })
  await page.evaluate(({ selector, index }) => {
    const code = document.querySelectorAll(selector)[index]
    if (!code) throw new Error(`Missing rendered code block ${index}`)

    const range = document.createRange()
    range.selectNodeContents(code)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, { selector: RICH_CODE_SELECTOR, index: blockIndex })
}

async function selectRawEditorText(page: Page, text: string) {
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 10_000 })
  await page.evaluate((expectedText) => {
    const content = document.querySelector('.cm-content') as (HTMLElement & {
      cmTile?: {
        view?: {
          state: { doc: { toString: () => string } }
          focus: () => void
          dispatch: (transaction: { selection: { anchor: number; head: number } }) => void
        }
      }
    }) | null
    const view = content?.cmTile?.view
    if (!view) throw new Error('CodeMirror view is not available')

    const documentText = view.state.doc.toString()
    const start = documentText.indexOf(expectedText)
    if (start === -1) throw new Error(`Raw editor text not found: ${expectedText}`)

    view.focus()
    view.dispatch({ selection: { anchor: start, head: start + expectedText.length } })
  }, text)
}

test.describe('Fenced code copy', () => {
  let tempVaultDir: string

  test.beforeEach(async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    tempVaultDir = createFixtureVaultCopy()
    writeCodeCopyFixtureNote(tempVaultDir)
    await openFixtureVault(page, tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('copies rich and raw fenced code selections without escape backslashes', async ({ page }) => {
    const noteList = page.locator('[data-testid="note-list-container"]')
    const noteItem = noteList.getByText(CODE_COPY_NOTE_TITLE, { exact: true })
    await expect(noteItem).toBeVisible({ timeout: 10_000 })
    await noteItem.click()

    await selectRichCodeBlock(page, 0)
    await expect.poll(() => copySelectedText(page)).toBe(JSON_SNIPPET)

    await selectRichCodeBlock(page, 1)
    await expect.poll(() => copySelectedText(page)).toBe(TYPESCRIPT_SNIPPET)

    await openCommandPalette(page)
    await executeCommand(page, 'Toggle Raw')
    await selectRawEditorText(page, JSON_SNIPPET)
    await expect.poll(() => copySelectedText(page)).toBe(JSON_SNIPPET)
  })
})
