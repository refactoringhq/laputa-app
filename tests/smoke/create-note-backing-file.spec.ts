import fs from 'fs'
import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

interface CreateNoteProbe {
  createCalls: string[]
  startedCreateCalls: string[]
  getBeforeCreate: string[]
  activeCreateCount: number
  maxConcurrentCreates: number
}

interface ProbeWindow {
  __mockHandlers?: Record<string, (args?: unknown) => unknown>
  __createNoteBackingFileProbe?: CreateNoteProbe
}

let tempVaultDir: string
const CREATE_NOTE_WRITE_DELAY_MS = 350

async function pinFixtureHandlers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probeWindow = window as typeof window & ProbeWindow
    const handlers = probeWindow.__mockHandlers
    if (!handlers?.create_note_content || !handlers.get_note_content) {
      throw new Error('Fixture vault handlers are missing create/read commands')
    }

    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      get: () => handlers,
      set: (nextHandlers) => Object.assign(handlers, nextHandlers),
    })
  })
}

async function recordCreateNoteCalls(page: Page): Promise<void> {
  await page.evaluate((writeDelayMs) => {
    const probeWindow = window as typeof window & ProbeWindow
    const handlers = probeWindow.__mockHandlers as Record<string, (args?: unknown) => unknown>

    const originalCreate = handlers.create_note_content.bind(handlers)
    const probe: CreateNoteProbe = {
      activeCreateCount: 0,
      createCalls: [],
      getBeforeCreate: [],
      maxConcurrentCreates: 0,
      startedCreateCalls: [],
    }
    probeWindow.__createNoteBackingFileProbe = probe

    handlers.create_note_content = async (args?: unknown) => {
      const notePath = String((args as { path?: unknown } | undefined)?.path ?? '')
      probe.startedCreateCalls.push(notePath)
      probe.activeCreateCount += 1
      probe.maxConcurrentCreates = Math.max(probe.maxConcurrentCreates, probe.activeCreateCount)
      try {
        await new Promise((resolve) => setTimeout(resolve, writeDelayMs))
        return await originalCreate(args)
      } finally {
        probe.activeCreateCount -= 1
        probe.createCalls.push(notePath)
      }
    }
  }, CREATE_NOTE_WRITE_DELAY_MS)
}

async function rejectReadsBeforeCreate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probeWindow = window as typeof window & ProbeWindow
    const handlers = probeWindow.__mockHandlers as Record<string, (args?: unknown) => unknown>
    const originalGet = handlers.get_note_content.bind(handlers)
    const probe = probeWindow.__createNoteBackingFileProbe as CreateNoteProbe

    handlers.get_note_content = (args?: unknown) => {
      const notePath = String((args as { path?: unknown } | undefined)?.path ?? '')
      if (notePath.includes('untitled-note-') && !probe.createCalls.includes(notePath)) {
        probe.getBeforeCreate.push(notePath)
        throw new Error(`File does not exist: ${notePath}`)
      }
      return originalGet(args)
    }
  })
}

async function installCreateNoteBackingFileProbe(page: Page): Promise<void> {
  await pinFixtureHandlers(page)
  await recordCreateNoteCalls(page)
  await rejectReadsBeforeCreate(page)
}

async function readProbe(page: Page): Promise<CreateNoteProbe> {
  return page.evaluate(() => {
    const probeWindow = window as typeof window & ProbeWindow
    return probeWindow.__createNoteBackingFileProbe ?? {
      activeCreateCount: 0,
      createCalls: [],
      getBeforeCreate: [],
      maxConcurrentCreates: 0,
      startedCreateCalls: [],
    }
  })
}

async function dispatchMenuCommandBurst(page: Page, commandId: string, count: number): Promise<void> {
  await page.waitForFunction(
    () => typeof window.__laputaTest?.dispatchBrowserMenuCommand === 'function',
    undefined,
    { timeout: 5_000 },
  )
  await page.evaluate(({ commandId: id, count: commandCount }) => {
    const testWindow = window as typeof window & {
      __laputaTest?: { dispatchBrowserMenuCommand?: (commandId: string) => void }
    }
    const dispatchBrowserMenuCommand = testWindow.__laputaTest?.dispatchBrowserMenuCommand
    if (typeof dispatchBrowserMenuCommand !== 'function') {
      throw new Error('Tolaria test bridge is missing dispatchBrowserMenuCommand')
    }
    for (let index = 0; index < commandCount; index += 1) {
      dispatchBrowserMenuCommand(id)
    }
  }, { commandId, count })
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultTauri(page, tempVaultDir)
  await installCreateNoteBackingFileProbe(page)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke creating a note writes its backing file before reload can read it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await triggerMenuCommand(page, 'file-new-note')
  await triggerMenuCommand(page, 'vault-reload')

  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+/i, {
    timeout: 5_000,
  })
  await expect.poll(() => readProbe(page), { timeout: 5_000 }).toMatchObject({
    createCalls: [expect.stringMatching(/untitled-note-\d+\.md$/)],
    getBeforeCreate: [],
  })

  const { createCalls, getBeforeCreate } = await readProbe(page)
  expect(getBeforeCreate).toEqual([])
  expect(errors.filter((message) => message.includes('File does not exist'))).toEqual([])
  expect(fs.readFileSync(createCalls[0], 'utf8')).toContain('type: Note')
})

test('@smoke rapid note creation waits for each backing file write', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await dispatchMenuCommandBurst(page, 'file-new-note', 2)

  await expect.poll(() => readProbe(page), { timeout: 7_000 }).toMatchObject({
    createCalls: [
      expect.stringMatching(/untitled-note-\d+\.md$/),
      expect.stringMatching(/untitled-note-\d+(?:-\d+)?\.md$/),
    ],
    getBeforeCreate: [],
    maxConcurrentCreates: 1,
    startedCreateCalls: [
      expect.stringMatching(/untitled-note-\d+\.md$/),
      expect.stringMatching(/untitled-note-\d+(?:-\d+)?\.md$/),
    ],
  })

  const { createCalls, getBeforeCreate, maxConcurrentCreates } = await readProbe(page)
  expect(new Set(createCalls).size).toBe(2)
  expect(getBeforeCreate).toEqual([])
  expect(maxConcurrentCreates).toBe(1)
  expect(errors.filter((message) => message.includes('#185') || message.includes('Maximum update depth'))).toEqual([])
})
