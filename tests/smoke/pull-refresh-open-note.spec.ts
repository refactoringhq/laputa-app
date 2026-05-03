import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

interface EditorSwapProbeWindow {
  __editorSwapEvents?: string[]
}

async function openNote(page: Page, title: string) {
  const noteList = page.getByTestId('note-list-container')
  await noteList.getByText(title, { exact: true }).click()
}

async function stubUpdatedPull(page: Page, updatedFile: string) {
  await page.evaluate((filePath) => {
    window.__mockHandlers!.git_pull = () => ({
      status: 'updated',
      message: 'Pulled 1 update from remote',
      updatedFiles: [filePath],
      conflictFiles: [],
    })
  }, updatedFile)
}

async function pullFromRemote(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Pull from Remote')
}

async function triggerPullCommand(page: Page) {
  await page.evaluate(() => {
    window.__laputaTest?.dispatchAppCommand?.('vault-pull')
  })
}

async function installEditorSwapProbe(page: Page) {
  await page.evaluate(() => {
    const probeWindow = window as typeof window & EditorSwapProbeWindow
    probeWindow.__editorSwapEvents = []
    window.addEventListener('laputa:editor-tab-swapped', (event) => {
      const customEvent = event as CustomEvent<{ path?: string }>
      probeWindow.__editorSwapEvents?.push(customEvent.detail?.path ?? '')
    })
  })
}

async function readEditorSwapCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probeWindow = window as typeof window & EditorSwapProbeWindow
    return probeWindow.__editorSwapEvents?.length ?? 0
  })
}

async function placeCaretAtEndOfBlock(page: Page, blockIndex: number) {
  const block = page.locator('.bn-block-content').nth(blockIndex)
  await expect(block).toBeVisible({ timeout: 5_000 })

  const placed = await block.evaluate((element) => {
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

async function expectEditorFocused(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return Boolean(active?.isContentEditable || active?.closest('[contenteditable="true"]'))
  }), { timeout: 5_000 }).toBe(true)
}

async function activeSelectionBlockType(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const selection = window.getSelection()
    const anchorNode = selection?.anchorNode ?? null
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null
    return anchorElement?.closest('.bn-block-content')?.getAttribute('data-content-type') ?? null
  })
}

test.describe('Pull refreshes the open note immediately', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    tempVaultDir = createFixtureVaultCopy()
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await page.setViewportSize({ width: 1600, height: 900 })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('successful pull refreshes the open editor and note list title immediately', async ({ page }) => {
    const originalTitle = 'Note B'
    const pulledTitle = `Pulled Note B ${Date.now()}`
    const pulledBody = `Pulled change ${Date.now()}`
    const notePath = path.join(tempVaultDir, 'note', 'note-b.md')

    await openNote(page, originalTitle)
    await expect(page.locator('.bn-editor h1').first()).toHaveText(originalTitle, { timeout: 5_000 })

    fs.writeFileSync(notePath, `---
Is A: Note
Status: Active
---

# ${pulledTitle}

${pulledBody}
`, 'utf8')
    await stubUpdatedPull(page, notePath)

    await pullFromRemote(page)

    await expect(page.getByText('Pulled 1 update(s) from remote')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.bn-editor h1').first()).toHaveText(pulledTitle, { timeout: 5_000 })
    await expect(page.locator('.bn-editor')).toContainText(pulledBody, { timeout: 5_000 })

    const noteList = page.getByTestId('note-list-container')
    await expect(noteList.getByText(pulledTitle, { exact: true })).toBeVisible({ timeout: 5_000 })
    await expect(noteList.getByText(originalTitle, { exact: true })).toHaveCount(0)
  })

  test('@smoke unrelated pull keeps the active editor mounted with selection in place', async ({ page }) => {
    const marker = `typing before unrelated pull ${Date.now()}`
    const noteBPath = path.join(tempVaultDir, 'note', 'note-b.md')
    const noteCPath = path.join(tempVaultDir, 'note', 'note-c.md')

    await openNote(page, 'Note B')
    await expect(page.locator('.bn-editor h1').first()).toHaveText('Note B', { timeout: 5_000 })
    await placeCaretAtEndOfBlock(page, 1)
    await page.keyboard.type(` ${marker}`, { delay: 20 })
    await expect(async () => {
      expect(fs.readFileSync(noteBPath, 'utf8')).toContain(marker)
    }).toPass({ timeout: 10_000 })

    await installEditorSwapProbe(page)
    await expectEditorFocused(page)

    fs.appendFileSync(noteCPath, `\n\nUnrelated pulled change ${Date.now()}\n`, 'utf8')
    await stubUpdatedPull(page, noteCPath)

    await triggerPullCommand(page)

    await expect(page.getByText('Pulled 1 update(s) from remote')).toBeVisible({ timeout: 5_000 })
    await page.waitForTimeout(500)
    expect(await readEditorSwapCount(page)).toBe(0)
    await expect.poll(() => activeSelectionBlockType(page), { timeout: 5_000 }).toBe('paragraph')
    await expectEditorFocused(page)
  })
})
