import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

const INLINE_LATEX = 'E=mc^2'
const DISPLAY_LATEX = '\\int_0^1 x^2 \\, dx = \\frac{1}{3}'
const MALFORMED_LATEX = '\\frac{'
const TABLE_INLINE_LATEX = '\\frac{a}{b}+c'
const TABLE_DISPLAY_STYLE_LATEX = '\\sum_{i=1}^{n} i'

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

async function expectMathNode(page: Page, selector: string, latex: string): Promise<void> {
  await expect.poll(async () =>
    page.locator(selector).evaluateAll((nodes, expectedLatex) =>
      nodes.some((node) => node.getAttribute('data-latex') === expectedLatex),
    latex),
  ).toBe(true)
}

function readNoteBFile(): string {
  return fs.readFileSync(path.join(tempVaultDir, 'note', 'note-b.md'), 'utf8')
}

test('LaTeX math source round-trips through rich mode, save, and reopen @smoke', async ({ page }) => {
  await openNote(page, 'Note B')
  await toggleRawMode(page, '.cm-content')

  const originalContent = await getRawEditorContent(page)
  const nextContent = `${originalContent.trimEnd()}

Inline math $${INLINE_LATEX}$ stays in prose.

$$
${DISPLAY_LATEX}
$$

Malformed math $${MALFORMED_LATEX}$ stays visible.

| Kind | Formula |
| --- | --- |
| inline | $${TABLE_INLINE_LATEX}$ |
| display-style | $$${TABLE_DISPLAY_STYLE_LATEX}$$ |
`

  await setRawEditorContent(page, nextContent)

  await expect.poll(readNoteBFile).toContain(`$${INLINE_LATEX}$`)
  await expect.poll(readNoteBFile).toContain(`$$\n${DISPLAY_LATEX}\n$$`)

  await toggleRawMode(page, '.bn-editor')

  await expectMathNode(page, '.math--inline', INLINE_LATEX)
  await expectMathNode(page, '.math--inline', TABLE_INLINE_LATEX)
  await expectMathNode(page, '.math--block', DISPLAY_LATEX)
  await expectMathNode(page, '.math--inline', MALFORMED_LATEX)
  await expect(page.locator('table')).toHaveCount(1)
  await expect(page.locator('.math .katex, .math .katex-error')).toHaveCount(4)

  await toggleRawMode(page, '.cm-content')
  const rawAfterRichMode = await getRawEditorContent(page)
  expect(rawAfterRichMode).toContain(`$${INLINE_LATEX}$`)
  expect(rawAfterRichMode).toContain(`$$\n${DISPLAY_LATEX}\n$$`)
  expect(rawAfterRichMode).toContain(`$${MALFORMED_LATEX}$`)
  expect(rawAfterRichMode).toContain(`$${TABLE_INLINE_LATEX}$`)
  expect(rawAfterRichMode).toContain(`$$${TABLE_DISPLAY_STYLE_LATEX}$$`)
  expect(rawAfterRichMode).not.toContain('@@TOLARIA_MATH')

  await toggleRawMode(page, '.bn-editor')
  await openNote(page, 'Note C')
  await openNote(page, 'Note B')
  await toggleRawMode(page, '.cm-content')

  const reopenedRaw = await getRawEditorContent(page)
  expect(reopenedRaw).toContain(`$${INLINE_LATEX}$`)
  expect(reopenedRaw).toContain(`$$\n${DISPLAY_LATEX}\n$$`)
  expect(reopenedRaw).toContain(`$${MALFORMED_LATEX}$`)
  expect(reopenedRaw).toContain(`$${TABLE_INLINE_LATEX}$`)
  expect(reopenedRaw).toContain(`$$${TABLE_DISPLAY_STYLE_LATEX}$$`)
  expect(reopenedRaw).not.toContain('@@TOLARIA_MATH')
})
