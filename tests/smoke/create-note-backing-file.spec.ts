import fs from 'fs'
import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

interface CreateNoteProbe {
  createCalls: string[]
  getBeforeCreate: string[]
}

interface ProbeWindow {
  __mockHandlers?: Record<string, (args?: unknown) => unknown>
  __createNoteBackingFileProbe?: CreateNoteProbe
}

let tempVaultDir: string

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
  await page.evaluate(() => {
    const probeWindow = window as typeof window & ProbeWindow
    const handlers = probeWindow.__mockHandlers as Record<string, (args?: unknown) => unknown>

    const originalCreate = handlers.create_note_content.bind(handlers)
    const probe: CreateNoteProbe = { createCalls: [], getBeforeCreate: [] }
    probeWindow.__createNoteBackingFileProbe = probe

    handlers.create_note_content = async (args?: unknown) => {
      const notePath = String((args as { path?: unknown } | undefined)?.path ?? '')
      await new Promise((resolve) => setTimeout(resolve, 100))
      const result = await originalCreate(args)
      probe.createCalls.push(notePath)
      return result
    }
  })
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
    return probeWindow.__createNoteBackingFileProbe ?? { createCalls: [], getBeforeCreate: [] }
  })
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
