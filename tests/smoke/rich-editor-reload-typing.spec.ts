import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

const IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAO+yK9sAAAAASUVORK5CYII='
const MEDIA_BLOCKQUOTE_NOTE_TITLE = 'Media Reload Blockquote'
const MEDIA_BLOCKQUOTE_TEXT = 'Quote before media reload'

let tempVaultDir: string

type TextBlockTarget = { text: string }
type NoteTitleTarget = { title: string }
type NotePathTarget = { notePath: string }
type MediaBlockquoteFile = { filePath: string }
type MockHandler = (args?: Record<string, unknown>) => unknown
type SaveProbe = Array<{ content: string; path: string }>
type SaveCountExpectation = { expectedCount: number; page: Page }
type RichEditorSaveProbeWindow = Window & typeof globalThis & {
  __mockHandlers?: Record<string, MockHandler>
  __richEditorTransformSaveProbe?: SaveProbe
}

function isEditorTypingCrash(message: string): boolean {
  return (
    message.includes('beforeinput') ||
    message.includes('Block with ID') ||
    message.includes('stale editor view') ||
    message.includes('Maximum update depth') ||
    message.includes('Cannot read properties') ||
    message.includes('undefined is not an object') ||
    message.includes('RangeError') ||
    message.includes('TypeError')
  )
}

function trackEditorTypingCrashes(page: Page): string[] {
  const messages: string[] = []
  page.on('pageerror', (error) => {
    if (isEditorTypingCrash(error.message)) messages.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && isEditorTypingCrash(message.text())) {
      messages.push(message.text())
    }
  })
  return messages
}

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

async function openNote(page: Page, title: string): Promise<void> {
  const noteList = page.getByTestId('note-list-container')
  await noteList.getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor h1').first()).toHaveText(title, { timeout: 5_000 })
}

async function createUntitledNote(page: Page): Promise<void> {
  await page.locator('body').click()
  await triggerMenuCommand(page, 'file-new-note')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+(?:-\d+)?/i, {
    timeout: 5_000,
  })
  const titleBlock = page.locator('.bn-block-content[data-content-type="heading"]').first()
  await expect(titleBlock).toBeVisible({ timeout: 5_000 })
  await titleBlock.click()
  await expectEditorFocused(page)
}

async function expectActiveFilename(page: Page, filenameStem: string): Promise<void> {
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(filenameStem, { timeout: 10_000 })
}

async function expectEditorFocused(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return Boolean(active?.isContentEditable || active?.closest('[contenteditable="true"]'))
  }), { timeout: 5_000 }).toBe(true)
}

async function placeCaretAtEndOfBlock(page: Page, blockIndex: number): Promise<void> {
  const block = page.locator('.bn-block-content').nth(blockIndex)
  await expect(block).toBeVisible({ timeout: 5_000 })

  await placeCaretAtEndOfBlockElement(block)
}

async function placeCaretAtEndOfBlockContaining(page: Page, target: TextBlockTarget): Promise<void> {
  const block = page.locator('.bn-block-content').filter({ hasText: target.text }).first()
  await expect(block).toBeVisible({ timeout: 5_000 })

  await placeCaretAtEndOfBlockElement(block)
}

async function placeCaretAtEndOfBlockElement(block: ReturnType<Page['locator']>): Promise<void> {
  const placed = await block.evaluate((element) => {
    const editable = element.closest('[contenteditable="true"]')
    if (editable instanceof HTMLElement) editable.focus()

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let lastTextNode: Text | null = null
    while (walker.nextNode()) {
      if (walker.currentNode.textContent) lastTextNode = walker.currentNode as Text
    }
    if (!lastTextNode) return false

    const range = document.createRange()
    range.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return true
  })

  expect(placed).toBe(true)
}

async function expectNoteFileToContain(filePath: string, marker: string): Promise<void> {
  await expect.poll(() => fs.readFileSync(filePath, 'utf8'), { timeout: 10_000 }).toContain(marker)
}

async function installRichEditorSaveProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probeWindow = window as RichEditorSaveProbeWindow
    const saves: SaveProbe = []
    const patchHandlers = (handlers?: Record<string, MockHandler> | null) => {
      if (!handlers || Reflect.get(handlers, '__richEditorTransformProbePatched') === true) {
        return handlers ?? null
      }

      const originalSaveNoteContent = handlers.save_note_content
      handlers.save_note_content = (args?: Record<string, unknown>) => {
        saves.push({
          content: typeof args?.content === 'string' ? args.content : '',
          path: typeof args?.path === 'string' ? args.path : '',
        })
        return originalSaveNoteContent?.(args)
      }
      Object.defineProperty(handlers, '__richEditorTransformProbePatched', {
        configurable: true,
        enumerable: false,
        value: true,
      })
      return handlers
    }

    let ref = patchHandlers(probeWindow.__mockHandlers) ?? null
    probeWindow.__richEditorTransformSaveProbe = saves
    Object.defineProperty(probeWindow, '__mockHandlers', {
      configurable: true,
      get() {
        return patchHandlers(ref) ?? ref
      },
      set(value) {
        ref = patchHandlers(value) ?? null
      },
    })
  })
}

async function expectSaveCount({ expectedCount, page }: SaveCountExpectation): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const probeWindow = window as RichEditorSaveProbeWindow
    return probeWindow.__richEditorTransformSaveProbe?.length ?? 0
  }), { timeout: 10_000 }).toBeGreaterThanOrEqual(expectedCount)
}

function writeChecklistNote(filePath: string, marker: string, checked = false): void {
  fs.writeFileSync(filePath, `---
Is A: Note
Status: Active
---

# Note B

- [${checked ? 'x' : ' '}] Toggle me
- [ ] Keep me

${marker}
`, 'utf8')
}

function writePlainNoteB(filePath: string, marker: string): void {
  fs.writeFileSync(filePath, `---
Is A: Note
Status: Active
---

# Note B

${marker}
`, 'utf8')
}

function writeMediaBlockquoteNote({ filePath }: MediaBlockquoteFile): void {
  fs.writeFileSync(filePath, `---
Is A: Note
Status: Active
---

# ${MEDIA_BLOCKQUOTE_NOTE_TITLE}

Intro paragraph before the media flow.

> ${MEDIA_BLOCKQUOTE_TEXT}

![Reload image](${IMAGE_DATA_URL})

Paragraph after media reload.
`, 'utf8')
}

function checklistCheckbox(page: Page, index: number) {
  return page.locator('.bn-block-content[data-content-type="checkListItem"] input[type="checkbox"]').nth(index)
}

async function retainCurrentChecklistCheckbox(page: Page): Promise<void> {
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __staleChecklistCheckbox?: HTMLInputElement | null }
    testWindow.__staleChecklistCheckbox = document.querySelector(
      '.bn-block-content[data-content-type="checkListItem"] input[type="checkbox"]',
    )
  })
}

async function dispatchRetainedChecklistChange(page: Page): Promise<void> {
  await page.evaluate(() => {
    const testWindow = window as typeof window & { __staleChecklistCheckbox?: HTMLInputElement | null }
    const checkbox = testWindow.__staleChecklistCheckbox
    if (!checkbox) throw new Error('Expected retained checklist checkbox')
    checkbox.checked = !checkbox.checked
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function reloadVault(page: Page): Promise<void> {
  await triggerMenuCommand(page, 'vault-reload')
  await expect(page.getByText(/Vault reloaded \(\d+ entries\)/).last()).toBeVisible({
    timeout: 5_000,
  })
}

async function stubUpdatedPull(page: Page, updatedFile: string): Promise<void> {
  await page.evaluate((filePath) => {
    window.__mockHandlers!.git_pull = () => ({
      status: 'updated',
      message: 'Pulled 1 update from remote',
      updatedFiles: [filePath],
      conflictFiles: [],
    })
  }, updatedFile)
}

async function pullFromRemote(page: Page): Promise<void> {
  await triggerMenuCommand(page, 'vault-pull')
  await expect(page.getByText('Pulled 1 update(s) from remote')).toBeVisible({ timeout: 5_000 })
}

async function notePathForTitle(page: Page, target: NoteTitleTarget): Promise<string> {
  const note = page
    .getByTestId('note-list-container')
    .locator('[data-note-path]')
    .filter({ hasText: target.title })
    .first()
  await expect(note).toBeVisible({ timeout: 5_000 })
  const notePath = await note.getAttribute('data-note-path')
  if (!notePath) throw new Error(`Missing data-note-path for ${target.title}`)
  return notePath
}

async function touchDragHandleForBlock(page: Page, target: TextBlockTarget): Promise<void> {
  const block = page.locator('.bn-block-content').filter({ hasText: target.text }).first()
  await expect(block).toBeVisible({ timeout: 5_000 })
  await block.hover()

  const dragHandle = page.getByRole('button', { name: 'Open block menu' }).first()
  await expect(dragHandle).toBeVisible({ timeout: 5_000 })
  await dragHandle.hover()
}

async function runMediaFrontmatterCycle(page: Page, target: NotePathTarget): Promise<void> {
  await page.evaluate(async ({ imageData, path }) => {
    const saveImage = window.__mockHandlers?.save_image
    const updateFrontmatter = window.__mockHandlers?.update_frontmatter
    if (typeof saveImage !== 'function') throw new Error('Fixture vault is missing save_image')
    if (typeof updateFrontmatter !== 'function') throw new Error('Fixture vault is missing update_frontmatter')

    await saveImage({ filename: 'reload-crash.png', data: imageData })
    await updateFrontmatter({ path, key: 'Status', value: 'Reviewed' })
  }, { imageData: IMAGE_DATA_URL, path: target.notePath })
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
  await page.setViewportSize({ width: 1400, height: 860 })
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke typing after a rich-editor reload and note switch stays usable', async ({ page }) => {
  const crashes = trackEditorTypingCrashes(page)
  const noteBPath = path.join(tempVaultDir, 'note', 'note-b.md')
  const draftMarker = `draft before reload ${Date.now()}`
  const afterReloadMarker = `typing after reload ${Date.now()}`

  await openNote(page, 'Note B')
  await placeCaretAtEndOfBlock(page, 1)
  await page.keyboard.type(` ${draftMarker}`, { delay: 10 })
  await expectNoteFileToContain(noteBPath, draftMarker)

  await placeCaretAtEndOfBlock(page, 1)
  await page.keyboard.type('/')
  await expect(page.locator('.bn-suggestion-menu')).toBeVisible({ timeout: 5_000 })

  await reloadVault(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('.bn-suggestion-menu')).not.toBeVisible({ timeout: 5_000 })

  await openNote(page, 'Alpha Project')
  await openNote(page, 'Note B')
  await placeCaretAtEndOfBlock(page, 1)
  await page.keyboard.type(` -> ${afterReloadMarker}`, { delay: 10 })

  await expectNoteFileToContain(noteBPath, afterReloadMarker)
  await page.waitForTimeout(500)
  expect(crashes).toEqual([])
})

test('@smoke rich-editor typing stays usable through repeated saves and transforms', async ({ page }) => {
  const crashes = trackEditorTypingCrashes(page)
  const noteBPath = path.join(tempVaultDir, 'note', 'note-b.md')
  const firstMarker = `repeated save transform first ${Date.now()}`
  const secondMarker = `repeated save transform second ${Date.now()}`
  const finalMarker = `repeated save transform final ${Date.now()}`

  await installRichEditorSaveProbe(page)
  await openNote(page, 'Note B')
  await placeCaretAtEndOfBlock(page, 1)

  await page.keyboard.type(` ${firstMarker} $x^2$`, { delay: 10 })
  await triggerMenuCommand(page, 'file-save')
  await expectSaveCount({ expectedCount: 1, page })

  await page.keyboard.type(` ${secondMarker} ->`, { delay: 10 })
  await triggerMenuCommand(page, 'file-save')
  await expectSaveCount({ expectedCount: 2, page })

  await page.keyboard.type(` ${finalMarker}`, { delay: 10 })
  await triggerMenuCommand(page, 'file-save')
  await expectSaveCount({ expectedCount: 3, page })

  await expectNoteFileToContain(noteBPath, finalMarker)
  expect(crashes).toEqual([])
})

test('typing after current-note filesystem refresh stays usable', async ({ page }) => {
  const crashes = trackEditorTypingCrashes(page)
  const noteBPath = path.join(tempVaultDir, 'note', 'note-b.md')
  const reloadMarker = `filesystem refresh ${Date.now()}`
  const afterRefreshMarker = `typing after filesystem refresh ${Date.now()}`

  await openNote(page, 'Note B')
  await placeCaretAtEndOfBlock(page, 1)

  writePlainNoteB(noteBPath, reloadMarker)
  await reloadVault(page)
  await page.getByTestId('note-list-container').getByText('Note B', { exact: true }).click()
  await expect(page.locator('.bn-editor')).toContainText(reloadMarker)

  await placeCaretAtEndOfBlock(page, 1)
  await page.keyboard.type(` -> ${afterRefreshMarker}`, { delay: 10 })

  await expectNoteFileToContain(noteBPath, afterRefreshMarker)
  await page.waitForTimeout(500)
  expect(crashes).toEqual([])
})

test('editing after create-note pull reload and note switch avoids React update loops', async ({ page }) => {
  const crashes = trackEditorTypingCrashes(page)
  const title = `Reload Loop Guard ${Date.now()}`
  const filenameStem = slugifyTitle(title)
  const createdNotePath = path.join(tempVaultDir, `${filenameStem}.md`)
  const noteCPath = path.join(tempVaultDir, 'note', 'note-c.md')
  const createdBody = `Created before reload loop ${Date.now()}`
  const pulledMarker = `Unrelated pulled reload loop change ${Date.now()}`
  const afterSwitchMarker = `typing after create pull reload ${Date.now()}`

  await createUntitledNote(page)
  await page.keyboard.type(title, { delay: 10 })
  await page.keyboard.press('Enter')
  await page.keyboard.type(createdBody, { delay: 10 })
  await expectActiveFilename(page, filenameStem)
  await expectNoteFileToContain(createdNotePath, createdBody)

  fs.appendFileSync(noteCPath, `\n\n${pulledMarker}\n`, 'utf8')
  await stubUpdatedPull(page, noteCPath)
  await pullFromRemote(page)
  await reloadVault(page)

  await openNote(page, 'Alpha Project')
  await openNote(page, title)
  await placeCaretAtEndOfBlockContaining(page, { text: createdBody })
  await page.keyboard.type(` ${afterSwitchMarker}`, { delay: 10 })

  await expectNoteFileToContain(createdNotePath, afterSwitchMarker)
  await expect(page.locator('.error-boundary')).toHaveCount(0)
  await page.waitForTimeout(500)
  expect(crashes).toEqual([])
})

test('checklist toggles after a rich-editor reload ignore stale checkbox events', async ({ page }) => {
  const crashes = trackEditorTypingCrashes(page)
  const noteBPath = path.join(tempVaultDir, 'note', 'note-b.md')
  const initialMarker = `initial checklist body ${Date.now()}`
  const reloadMarker = `reloaded checklist body ${Date.now()}`

  writeChecklistNote(noteBPath, initialMarker)
  await openNote(page, 'Note B')
  await expect(checklistCheckbox(page, 0)).not.toBeChecked()
  await retainCurrentChecklistCheckbox(page)

  writeChecklistNote(noteBPath, reloadMarker)
  await reloadVault(page)
  await openNote(page, 'Alpha Project')
  await openNote(page, 'Note B')
  await expect(page.locator('.bn-editor')).toContainText(reloadMarker)

  await dispatchRetainedChecklistChange(page)

  const liveCheckbox = checklistCheckbox(page, 0)
  await liveCheckbox.click()
  await expect(liveCheckbox).toBeChecked()
  await expectNoteFileToContain(noteBPath, '- [x] Toggle me')
  await page.waitForTimeout(500)
  expect(crashes).toEqual([])
})

test('clicking back into a blockquote after media and frontmatter reload stays usable', async ({ page }) => {
  const crashes = trackEditorTypingCrashes(page)
  const notePath = path.join(tempVaultDir, 'note', 'media-reload-blockquote.md')
  const afterReloadMarker = `block quote click after media reload ${Date.now()}`

  writeMediaBlockquoteNote({ filePath: notePath })
  await reloadVault(page)
  await openNote(page, MEDIA_BLOCKQUOTE_NOTE_TITLE)
  await expect(page.locator('.bn-editor img.bn-visual-media')).toBeVisible({ timeout: 5_000 })
  await touchDragHandleForBlock(page, { text: MEDIA_BLOCKQUOTE_TEXT })

  const openedNotePath = await notePathForTitle(page, { title: MEDIA_BLOCKQUOTE_NOTE_TITLE })
  await runMediaFrontmatterCycle(page, { notePath: openedNotePath })
  await reloadVault(page)
  await expect(page.locator('.bn-editor')).toContainText(MEDIA_BLOCKQUOTE_TEXT)

  await touchDragHandleForBlock(page, { text: MEDIA_BLOCKQUOTE_TEXT })
  await placeCaretAtEndOfBlockContaining(page, { text: MEDIA_BLOCKQUOTE_TEXT })
  await page.keyboard.type(` ${afterReloadMarker}`, { delay: 10 })

  await expectNoteFileToContain(notePath, afterReloadMarker)
  await page.waitForTimeout(500)
  expect(crashes).toEqual([])
})
