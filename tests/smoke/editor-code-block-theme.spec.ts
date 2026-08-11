import { expect, test, type Locator, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

const CODE_NOTE_RELATIVE_PATH = path.join('note', 'code-block-theme.md')
const CODE_NOTE_TITLE = 'Code Block Theme'
const PASTED_CPP_SNIPPET = '#include <iostream>\nint main() { return 0; }'
const NAVIGATION_SNIPPET = 'alpha\nbravo\ncharlie'
const NAVIGATION_AFTER_TEXT = 'Navigation boundary after.'
const LONG_SOURCE_LINE = 'This deliberately long source line must wrap inside the narrow editor. '.repeat(8)

function writeCodeThemeFixtureNote(tempVaultDir: string) {
  const notePath = path.join(tempVaultDir, CODE_NOTE_RELATIVE_PATH)
  fs.mkdirSync(path.dirname(notePath), { recursive: true })
  fs.writeFileSync(notePath, `---
Is A: Note
Status: Active
---

# ${CODE_NOTE_TITLE}

Inline \`const answer = 42\` should stay on the lighter inline chip.

\`\`\`ts
function paint(answer: number) {
  return answer + 42
}

console.log(paint(1))
const wrapped = "${LONG_SOURCE_LINE}"
console.log(wrapped)




\`\`\`

Convert this paragraph with the shortcut.

Navigation boundary before.

\`\`\`text
${NAVIGATION_SNIPPET}
\`\`\`

${NAVIGATION_AFTER_TEXT}
`)
}

async function backgroundColor(locator: Locator) {
  return locator.evaluate((element) => getComputedStyle(element).backgroundColor)
}

async function textColor(locator: Locator) {
  return locator.evaluate((element) => getComputedStyle(element).color)
}

async function tokenColors(locator: Locator) {
  return locator.evaluateAll((elements) => (
    Array.from(new Set(elements.map((element) => getComputedStyle(element).color)))
  ))
}

async function codeBlockLineNumberGeometry(codeBlock: Locator) {
  return codeBlock.evaluate((block) => {
    const code = block.querySelector<HTMLElement>('pre code')
    if (!code) return null
    const firstMarker = code.querySelector<HTMLElement>('[data-code-line-number="1"]')
    if (!firstMarker) return null
    const postWrapMarker = code.querySelector<HTMLElement>('[data-code-line-number="7"]')
    if (!postWrapMarker) return null
    const lastMarker = code.querySelector<HTMLElement>('[data-code-line-number="11"]')
    if (!lastMarker) return null
    const firstSourceToken = firstMarker.nextElementSibling
    if (!(firstSourceToken instanceof HTMLElement)) return null
    const postWrapSourceToken = postWrapMarker.nextElementSibling
    if (!(postWrapSourceToken instanceof HTMLElement)) return null

    const blockRect = block.getBoundingClientRect()
    const firstMarkerRect = firstMarker.getBoundingClientRect()
    const postWrapMarkerRect = postWrapMarker.getBoundingClientRect()
    const lastMarkerRect = lastMarker.getBoundingClientRect()
    const firstSourceRect = firstSourceToken.getBoundingClientRect()
    const postWrapSourceRect = postWrapSourceToken.getBoundingClientRect()
    const postWrapMarkerCenter = postWrapMarkerRect.top + postWrapMarkerRect.height / 2
    const postWrapSourceCenter = postWrapSourceRect.top + postWrapSourceRect.height / 2

    return {
      blockBottom: blockRect.bottom,
      blockTop: blockRect.top,
      firstNumberTop: firstMarkerRect.top,
      lastNumberBottom: lastMarkerRect.bottom,
      numberGap: firstSourceRect.left - firstMarkerRect.right,
      postWrapCenterDelta: Math.abs(postWrapMarkerCenter - postWrapSourceCenter),
      sourceLeftOffset: firstSourceRect.left - blockRect.left,
    }
  })
}

async function pasteMarkdownCodeBlock(page: Page, source: string) {
  await page.evaluate(async (markdown) => {
    await navigator.clipboard.writeText(markdown)
  }, `\`\`\`\n${source}\n\`\`\``)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
}

async function placeCaretAtTextOffset(locator: Locator, offset: number) {
  await locator.evaluate((element, absoluteOffset) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let remaining = absoluteOffset
    let textNode = walker.nextNode()

    while (textNode) {
      const length = textNode.textContent?.length ?? 0
      if (remaining <= length) {
        const selection = element.ownerDocument.getSelection()
        const range = element.ownerDocument.createRange()
        range.setStart(textNode, remaining)
        range.collapse(true)
        selection?.removeAllRanges()
        selection?.addRange(range)
        return
      }
      remaining -= length
      textNode = walker.nextNode()
    }

    throw new Error(`Unable to place caret at code offset ${absoluteOffset}`)
  }, offset)
}

function readCaretBlockContext() {
  const selection = document.getSelection() as Selection
  const anchorNode = selection.anchorNode as Node
  const anchorElement = anchorNode instanceof Element
    ? anchorNode
    : anchorNode.parentElement as Element
  const block = anchorElement.closest<HTMLElement>('[data-content-type]') as HTMLElement
  const textElement = block.dataset.contentType === 'codeBlock'
    ? block.querySelector('pre code') as Element
    : block
  return {
    text: textElement.textContent,
    type: block.dataset.contentType,
  }
}

async function caretBlockContext(page: Page) {
  return page.evaluate(readCaretBlockContext)
}

async function caretTextOffset(locator: Locator) {
  return locator.evaluate((element) => {
    const selection = element.ownerDocument.getSelection() as Selection
    const range = element.ownerDocument.createRange()
    range.selectNodeContents(element)
    range.setEnd(selection.anchorNode as Node, selection.anchorOffset)
    return range.toString().length
  })
}

test.describe('Editor code block theme', () => {
  test.setTimeout(60_000)
  let tempVaultDir: string

  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
    writeCodeThemeFixtureNote(tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('fenced code blocks follow the active theme while inline code stays muted', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    const noteList = page.locator('[data-testid="note-list-container"]')
    const noteItem = noteList.getByText(CODE_NOTE_TITLE, { exact: true })
    await expect(noteItem).toBeVisible({ timeout: 10_000 })
    await noteItem.click()

    const inlineCode = page
      .locator('[data-content-type="paragraph"] [data-style-type="code"], [data-content-type="paragraph"] code')
      .first()
    const codeBlock = page.locator('.bn-block-content[data-content-type="codeBlock"]').first()
    const fencedCode = codeBlock.locator('pre code').first()
    const highlightedToken = codeBlock.locator('.shiki').first()
    const highlightedTokens = codeBlock.locator('.shiki')

    await expect(codeBlock).toBeVisible({ timeout: 10_000 })
    await expect(inlineCode).toBeVisible({ timeout: 10_000 })
    await expect(fencedCode).toBeVisible()
    await expect(codeBlock.locator('[data-code-line-number]')).toHaveCount(11)
    await expect.poll(() => fencedCode.evaluate((element) => {
      const pre = element.closest('pre')
      return pre ? pre.scrollWidth <= pre.clientWidth : false
    })).toBe(true)
    const gutterGeometry = await codeBlockLineNumberGeometry(codeBlock)
    expect(gutterGeometry).not.toBeNull()
    if (gutterGeometry === null) throw new Error('Code block line-number geometry was unavailable')
    expect(gutterGeometry.firstNumberTop).toBeGreaterThanOrEqual(gutterGeometry.blockTop)
    expect(gutterGeometry.lastNumberBottom).toBeLessThanOrEqual(gutterGeometry.blockBottom)
    expect(gutterGeometry.numberGap).toBeGreaterThanOrEqual(8)
    expect(gutterGeometry.postWrapCenterDelta).toBeLessThanOrEqual(0.5)
    expect(gutterGeometry.sourceLeftOffset).toBeLessThanOrEqual(80)

    await expect.poll(() => backgroundColor(inlineCode)).toBe('rgb(240, 240, 239)')
    await expect.poll(() => backgroundColor(fencedCode)).toBe('rgba(0, 0, 0, 0)')
    await expect.poll(() => textColor(fencedCode)).toBe('rgb(55, 53, 47)')
    const lightCodeBlockBackground = await backgroundColor(codeBlock)
    const lightTokenColors = await tokenColors(highlightedTokens)
    expect(lightTokenColors.length).toBeGreaterThan(0)

    await page.getByTestId('status-theme-mode').click()
    await expect.poll(() => backgroundColor(codeBlock)).toBe('rgb(22, 22, 22)')
    await expect.poll(() => textColor(fencedCode)).toBe('rgb(255, 255, 255)')
    await expect.poll(() => tokenColors(highlightedTokens)).not.toEqual(lightTokenColors)
    const darkTokenColors = await tokenColors(highlightedTokens)

    await page.getByTestId('status-theme-mode').click()
    await expect.poll(() => backgroundColor(codeBlock)).toBe(lightCodeBlockBackground)
    await expect.poll(() => textColor(fencedCode)).toBe('rgb(55, 53, 47)')
    await expect.poll(() => tokenColors(highlightedTokens)).not.toEqual(darkTokenColors)
    await expect(highlightedToken).toBeVisible()
  })

  test('creates a code block by shortcut and scopes select-all to its source', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    const noteItem = page.locator('[data-testid="note-list-container"]')
      .getByText(CODE_NOTE_TITLE, { exact: true })
    await expect(noteItem).toBeVisible({ timeout: 10_000 })
    await noteItem.click()

    const source = 'Convert this paragraph with the shortcut.'
    await expect(page.locator('.bn-editor')).toContainText(source, { timeout: 10_000 })
    const paragraph = page.locator('.bn-editor [data-content-type="paragraph"]')
      .filter({ hasText: source })
      .last()
    await expect(paragraph).toBeVisible()
    await paragraph.click()
    await page.keyboard.press(process.platform === 'darwin'
      ? 'Meta+Shift+Backquote'
      : 'Control+Shift+Backquote')

    const createdCode = page.locator('[data-content-type="codeBlock"] pre code', { hasText: source })
    await expect(createdCode).toBeVisible()
    await createdCode.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe(source)
  })

  test('pasted code blocks keep an editable language selector', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openFixtureVault(page, tempVaultDir)
    const noteItem = page.locator('[data-testid="note-list-container"]')
      .getByText(CODE_NOTE_TITLE, { exact: true })
    await expect(noteItem).toBeVisible({ timeout: 10_000 })
    await noteItem.click()

    const pasteTarget = page.locator('.bn-editor [data-content-type="paragraph"]')
      .filter({ hasText: 'Convert this paragraph with the shortcut.' })
      .last()
    await expect(pasteTarget).toBeVisible()
    await pasteTarget.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await pasteMarkdownCodeBlock(page, PASTED_CPP_SNIPPET)

    const pastedCodeBlock = page
      .locator('.bn-block-content[data-content-type="codeBlock"]')
      .filter({ hasText: '#include <iostream>' })
      .last()
    await expect(pastedCodeBlock).toBeVisible({ timeout: 10_000 })

    const blockId = await pastedCodeBlock.locator('xpath=ancestor::*[@data-id][1]')
      .getAttribute('data-id')
    expect(blockId).toBeTruthy()
    const nativeLanguageSelect = pastedCodeBlock.locator('select').first()
    const languageSelect = page.locator(
      `.editor__code-block-language-overlay[data-code-block-id="${blockId}"] [data-slot="select-trigger"]`,
    )
    await expect(languageSelect).toBeVisible()
    await expect(languageSelect).toBeEnabled()
    await expect(languageSelect).toContainText('Plain Text')
    await expect.poll(() => nativeLanguageSelect.evaluate((select) => (
      getComputedStyle(select).visibility
    ))).toBe('hidden')
    await expect.poll(() => languageSelect.evaluate((select) => {
      const style = getComputedStyle(select)
      return {
        cursor: style.cursor,
        height: select.getBoundingClientRect().height,
      }
    })).toEqual({
      cursor: 'pointer',
      height: 28,
    })

    await languageSelect.click()
    await page.getByRole('option', { name: 'C++' }).click()
    await expect(languageSelect).toContainText('C++')
    await expect.poll(() => fs.readFileSync(path.join(tempVaultDir, CODE_NOTE_RELATIVE_PATH), 'utf8'), {
      timeout: 10_000,
    }).toContain(`\`\`\`cpp\n${PASTED_CPP_SNIPPET}\n\`\`\``)
  })

  test('moves down within code and exits only at the final logical line', async ({ page }) => {
    await openFixtureVault(page, tempVaultDir)
    const noteItem = page.locator('[data-testid="note-list-container"]')
      .getByText(CODE_NOTE_TITLE, { exact: true })
    await expect(noteItem).toBeVisible({ timeout: 10_000 })
    await noteItem.click()

    const code = page.locator('[data-content-type="codeBlock"] pre code')
      .filter({ hasText: NAVIGATION_SNIPPET })
    await expect(code).toBeVisible({ timeout: 10_000 })

    await placeCaretAtTextOffset(code, NAVIGATION_SNIPPET.indexOf('bravo'))
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => caretBlockContext(page)).toEqual({
      text: NAVIGATION_SNIPPET,
      type: 'codeBlock',
    })

    const wrappedCode = page.locator('[data-content-type="codeBlock"] pre code')
      .filter({ hasText: LONG_SOURCE_LINE })
    const wrappedSource = await wrappedCode.textContent()
    const wrappedStart = wrappedSource.indexOf(LONG_SOURCE_LINE)
    const wrappedEnd = wrappedStart + LONG_SOURCE_LINE.length
    await placeCaretAtTextOffset(wrappedCode, wrappedStart + 20)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => caretTextOffset(wrappedCode)).toBeGreaterThan(wrappedStart + 20)
    await expect.poll(() => caretTextOffset(wrappedCode)).toBeLessThan(wrappedEnd)

    await placeCaretAtTextOffset(code, NAVIGATION_SNIPPET.length)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => caretBlockContext(page)).toEqual({
      text: NAVIGATION_AFTER_TEXT,
      type: 'paragraph',
    })
  })
})
