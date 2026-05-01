import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

let tempVaultDir: string

function isEditorTypingCrash(message: string): boolean {
  return (
    message.includes('beforeinput') ||
    message.includes('stale editor view') ||
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

async function openNote(page: Page, title: string): Promise<void> {
  const noteList = page.getByTestId('note-list-container')
  await noteList.getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor h1').first()).toHaveText(title, { timeout: 5_000 })
}

async function placeCaretAtEndOfBlock(page: Page, blockIndex: number): Promise<void> {
  const block = page.locator('.bn-block-content').nth(blockIndex)
  await expect(block).toBeVisible({ timeout: 5_000 })

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

async function reloadVault(page: Page): Promise<void> {
  await triggerMenuCommand(page, 'vault-reload')
  await expect(page.getByText(/Vault reloaded \(\d+ entries\)/).last()).toBeVisible({
    timeout: 5_000,
  })
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
