import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { sendShortcut } from './helpers'

const LONG_NOTE_TITLE = 'Long Note Scaling QA'
const LONG_NOTE_RELATIVE_PATH = path.join('note', 'long-note-scaling-qa.md')
const PARAGRAPH_COUNT = 82
const WORDS_PER_PARAGRAPH = 50

let tempVaultDir: string
let longNotePath: string

function segmentLabel(index: number): string {
  return `Segment ${String(index).padStart(3, '0')}`
}

function makeLongNoteMarkdown(): string {
  const paragraphs = Array.from({ length: PARAGRAPH_COUNT }, (_, paragraphIndex) => {
    const segment = segmentLabel(paragraphIndex + 1)
    const words = Array.from({ length: WORDS_PER_PARAGRAPH }, (_, wordIndex) =>
      `scale${String(paragraphIndex + 1).padStart(3, '0')}_${String(wordIndex + 1).padStart(2, '0')}`,
    )
    return `${segment} ${words.join(' ')}`
  })

  return `---\ntype: note\n---\n\n# ${LONG_NOTE_TITLE}\n\n${paragraphs.join('\n\n')}\n`
}

async function openNote(page: Page, title: string): Promise<void> {
  const noteList = page.locator('[data-testid="note-list-container"]')
  await noteList.getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor h1').first()).toHaveText(title, { timeout: 8_000 })
}

async function appendTextToSegment(page: Page, segment: string, text: string): Promise<void> {
  const paragraph = page.locator('.bn-editor p').filter({ hasText: segment }).first()
  await paragraph.scrollIntoViewIfNeeded()
  await paragraph.click()
  await page.keyboard.press('End')
  await page.keyboard.type(text)
  await expect(page.locator('.bn-editor')).toContainText(text.trim(), { timeout: 5_000 })
}

async function editorScrollTop(page: Page): Promise<number> {
  return page.locator('.editor-scroll-area').evaluate((element) => element.scrollTop)
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000)
  tempVaultDir = createFixtureVaultCopy()
  longNotePath = path.join(tempVaultDir, LONG_NOTE_RELATIVE_PATH)
  fs.writeFileSync(longNotePath, makeLongNoteMarkdown(), 'utf8')
  await openFixtureVaultDesktopHarness(page, tempVaultDir, { expectedReadyTitle: LONG_NOTE_TITLE })
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('long rich-editor notes stay editable across typing, wikilinks, save, and note switches', async ({ page }) => {
  const beginningEdit = ` beginning edit ${Date.now()}`
  const middleEdit = ` middle edit ${Date.now()}`
  const endEdit = ` end edit ${Date.now()}`

  await openNote(page, LONG_NOTE_TITLE)

  await appendTextToSegment(page, segmentLabel(1), beginningEdit)
  await appendTextToSegment(page, segmentLabel(41), middleEdit)
  await appendTextToSegment(page, segmentLabel(82), endEdit)

  const wikilinkParagraph = page.locator('.bn-editor p').filter({ hasText: segmentLabel(41) }).first()
  await wikilinkParagraph.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' [[Alpha')

  const wikilinkMenu = page.locator('.wikilink-menu')
  await expect(wikilinkMenu).toBeVisible({ timeout: 5_000 })
  await expect(wikilinkMenu).toContainText('Alpha Project')
  await page.keyboard.press('Enter')
  await expect(page.locator('.bn-editor .wikilink').filter({ hasText: 'Alpha Project' }).last()).toBeVisible()

  await page.keyboard.press('PageUp')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('PageDown')
  await sendShortcut(page, 's', ['Control'])

  await openNote(page, 'Note B')
  await openNote(page, LONG_NOTE_TITLE)

  const editor = page.locator('.bn-editor')
  await expect(editor).toContainText(beginningEdit.trim(), { timeout: 5_000 })
  await expect(editor).toContainText(middleEdit.trim(), { timeout: 5_000 })
  await expect(editor).toContainText(endEdit.trim(), { timeout: 5_000 })
  await expect(editor.locator('.wikilink').filter({ hasText: 'Alpha Project' }).last()).toBeVisible()

  await expect.poll(() => fs.readFileSync(longNotePath, 'utf8'), { timeout: 5_000 }).toContain(beginningEdit.trim())
  await expect.poll(() => fs.readFileSync(longNotePath, 'utf8'), { timeout: 5_000 }).toContain(middleEdit.trim())
  await expect.poll(() => fs.readFileSync(longNotePath, 'utf8'), { timeout: 5_000 }).toContain(endEdit.trim())
})

test('opening the plus menu at the end of a long note preserves scroll position', async ({ page }) => {
  await openNote(page, LONG_NOTE_TITLE)

  const tailParagraph = page.locator('.bn-editor p').filter({ hasText: segmentLabel(PARAGRAPH_COUNT) }).first()
  await tailParagraph.scrollIntoViewIfNeeded()
  const beforeScrollTop = await editorScrollTop(page)
  const beforeTailTop = await tailParagraph.evaluate((element) => element.getBoundingClientRect().top)
  expect(beforeScrollTop).toBeGreaterThan(0)

  const tailParagraphBox = await tailParagraph.boundingBox()
  if (!tailParagraphBox) throw new Error('Tail paragraph was not visible')
  await page.mouse.move(tailParagraphBox.x + 12, tailParagraphBox.y + 12)
  const addBlockButton = page.locator('.bn-side-menu button:has([data-test="dragHandleAdd"])').first()
  await expect(addBlockButton).toBeVisible({ timeout: 5_000 })
  const addBlockButtonBox = await addBlockButton.boundingBox()
  if (!addBlockButtonBox) throw new Error('Add block button was not visible')
  await page.mouse.click(
    addBlockButtonBox.x + addBlockButtonBox.width / 2,
    addBlockButtonBox.y + addBlockButtonBox.height / 2,
  )
  await expect(page.locator('.bn-suggestion-menu')).toBeVisible({ timeout: 5_000 })

  const afterTailTop = await tailParagraph.evaluate((element) => element.getBoundingClientRect().top)
  expect(Math.abs(afterTailTop - beforeTailTop)).toBeLessThanOrEqual(2)
})
