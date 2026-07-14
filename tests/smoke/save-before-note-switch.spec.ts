import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'
import { triggerMenuCommand } from './testBridge'

let tempVaultDir: string
type SaveBeforeSwitchProbeWindow = Window & typeof globalThis & {
  __mockHandlers?: Record<string, (args?: Record<string, unknown>) => unknown>
  __saveBeforeSwitchProbe?: {
    calls: Array<{ path: string; content: string }>
    release: () => void
  }
  __saveBeforeSwitchProbeGate?: Promise<void>
}

function isReactUpdateLoop(message: string): boolean {
  return (
    message.includes('Maximum update depth') ||
    message.includes('React error #185') ||
    message.includes('#185')
  )
}

function collectReactUpdateLoopErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    if (isReactUpdateLoop(error.message)) errors.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && isReactUpdateLoop(message.text())) {
      errors.push(message.text())
    }
  })
  return errors
}

async function openNote(page: Page, title: string) {
  const noteList = page.locator('[data-testid="note-list-container"]')
  await noteList.getByText(title, { exact: true }).click()
}

async function openRawMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 })
}

async function openPropertiesPanel(page: Page) {
  const openPanelButton = page.getByRole('button', { name: 'Open the properties panel' })
  if (await openPanelButton.count()) {
    await openPanelButton.click()
  }
}

async function getRawEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    if (!el) return ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = (el as any).cmTile?.view
    if (view) return view.state.doc.toString() as string
    return el.textContent ?? ''
  })
}

async function setRawEditorContent(page: Page, content: string) {
  await page.evaluate((nextContent) => {
    const el = document.querySelector('.cm-content')
    if (!el) {
      throw new Error('CodeMirror content element is missing')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = (el as any).cmTile?.view
    if (!view) {
      throw new Error('CodeMirror view is missing')
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextContent },
    })
  }, content)
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

function initializeDelayedSaveProbeState(): void {
  const probeWindow = window as SaveBeforeSwitchProbeWindow
  let releaseSave: (() => void) | null = null
  probeWindow.__saveBeforeSwitchProbeGate = new Promise<void>((resolve) => { releaseSave = resolve })
  probeWindow.__saveBeforeSwitchProbe = {
    calls: [],
    release: () => { releaseSave?.() },
  }
}

function installDelayedSaveProbeInterceptor(): void {
  const probeWindow = window as SaveBeforeSwitchProbeWindow

  const readStringArg = (args: Record<string, unknown> | undefined, key: string) => {
    const value = args?.[key]
    return typeof value === 'string' ? value : ''
  }

  const patchHandlers = (handlers?: Record<string, (args?: Record<string, unknown>) => unknown> | null) => {
    if (!handlers) return null
    if (Reflect.get(handlers, '__saveBeforeSwitchProbePatched') === true) return handlers

    const originalSave = handlers.save_note_content
    if (!originalSave) throw new Error('save_note_content handler is unavailable')

    handlers.save_note_content = async (args?: Record<string, unknown>) => {
      probeWindow.__saveBeforeSwitchProbe?.calls.push({
        path: readStringArg(args, 'path'),
        content: readStringArg(args, 'content'),
      })
      await probeWindow.__saveBeforeSwitchProbeGate
      return originalSave(args)
    }
    Object.defineProperty(handlers, '__saveBeforeSwitchProbePatched', {
      configurable: true,
      enumerable: false,
      value: true,
    })
    return handlers
  }

  let ref = patchHandlers(probeWindow.__mockHandlers)
  Object.defineProperty(probeWindow, '__mockHandlers', {
    configurable: true,
    get() {
      return patchHandlers(ref) ?? ref
    },
    set(value) {
      ref = patchHandlers(value)
    },
  })
}

async function installDelayedSaveProbe(page: Page): Promise<void> {
  await page.evaluate(initializeDelayedSaveProbeState)
  await page.evaluate(installDelayedSaveProbeInterceptor)
}

async function releaseDelayedSave(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probeWindow = window as SaveBeforeSwitchProbeWindow
    probeWindow.__saveBeforeSwitchProbe?.release()
  })
}

async function delayedSaveCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probeWindow = window as SaveBeforeSwitchProbeWindow
    return probeWindow.__saveBeforeSwitchProbe?.calls.length ?? 0
  })
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke switching notes persists unsaved raw edits without waiting for the debounce window', async ({ page }) => {
  const noteBPath = path.join(tempVaultDir, 'note', 'note-b.md')
  const appendedText = `Flushed before note switch ${Date.now()}`

  await openNote(page, 'Note B')
  await openRawMode(page)

  const rawContent = await getRawEditorContent(page)
  await setRawEditorContent(page, `${rawContent}\n\n${appendedText}`)
  await page.waitForTimeout(100)

  await openNote(page, 'Alpha Project')

  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('alpha-project', { timeout: 5_000 })
  await expect.poll(async () => getRawEditorContent(page)).toContain('# Alpha Project')
  await expect.poll(
    () => fs.readFileSync(noteBPath, 'utf8'),
    { timeout: 450, intervals: [50, 100, 100, 100, 100] },
  ).toContain(appendedText)
})

test('@smoke switching notes during a slow rich-editor save writes once and opens the latest note', async ({ page }) => {
  const errors = collectReactUpdateLoopErrors(page)
  const noteBPath = path.join(tempVaultDir, 'note', 'note-b.md')
  const appendedText = `Slow rich save before switch ${Date.now()}`
  const noteList = page.locator('[data-testid="note-list-container"]')

  await installDelayedSaveProbe(page)
  await openNote(page, 'Note B')
  await expect(page.locator('.bn-editor h1').first()).toHaveText('Note B', { timeout: 5_000 })

  await placeCaretAtEndOfBlock(page, 1)
  await page.keyboard.type(` ${appendedText}`, { delay: 10 })
  await expect(page.locator('.bn-block-content').filter({ hasText: appendedText })).toBeVisible({ timeout: 5_000 })
  await page.waitForTimeout(100)
  await triggerMenuCommand(page, 'file-save')
  await expect.poll(() => delayedSaveCount(page), { timeout: 5_000 }).toBe(1)

  await noteList.getByText('Alpha Project', { exact: true }).click()
  await noteList.getByText('Note C', { exact: true }).click()

  await expect.poll(() => delayedSaveCount(page), { timeout: 5_000 }).toBe(1)
  await releaseDelayedSave(page)

  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('note-c', { timeout: 10_000 })
  await expect.poll(
    () => fs.readFileSync(noteBPath, 'utf8'),
    { timeout: 10_000 },
  ).toContain(appendedText)
  expect(errors).toEqual([])
})

test('@smoke deleting a property after switching notes keeps the current note editable', async ({ page }) => {
  const alphaPath = path.join(tempVaultDir, 'project', 'alpha-project.md')

  await openNote(page, 'Note B')
  await openPropertiesPanel(page)
  await expect(page.getByTestId('editable-property').filter({ hasText: 'Status' })).toBeVisible()

  await openNote(page, 'Alpha Project')
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('alpha-project', { timeout: 5_000 })

  const ownerRow = page.getByTestId('editable-property').filter({ hasText: 'Owner' })
  await expect(ownerRow).toBeVisible()
  await ownerRow.hover()
  await ownerRow.getByTitle('Delete property').click({ force: true })

  await expect(ownerRow).toHaveCount(0)
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('alpha-project')
  await expect.poll(
    () => fs.readFileSync(alphaPath, 'utf8'),
    { timeout: 1_000, intervals: [50, 100, 200, 300, 350] },
  ).not.toContain('Owner:')
})
