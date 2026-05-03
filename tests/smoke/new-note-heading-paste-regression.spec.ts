import fs from 'fs'
import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

const EDITOR_CRASH_FRAGMENTS = [
  '#185',
  'Maximum update depth',
  'fillBefore',
  'pasteHTML',
  'RangeError',
]

interface TitleInput {
  title: string
}

interface VaultPathInput {
  vaultPath: string
}

interface FileContentExpectation extends VaultPathInput {
  filename: string
  text: string
}

interface RichHeadingPastePayload {
  html: string
  text: string
}

function slugifyTitle({ title }: TitleInput): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function markdownFiles({ vaultPath }: VaultPathInput): string[] {
  return fs.readdirSync(vaultPath).filter((name) => name.endsWith('.md')).sort()
}

function collectEditorCrashMessages(page: Page): string[] {
  const messages: string[] = []
  const collect = (message: string) => {
    if (EDITOR_CRASH_FRAGMENTS.some((fragment) => message.includes(fragment))) {
      messages.push(message)
    }
  }

  page.on('pageerror', (error) => collect(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') collect(message.text())
  })

  return messages
}

async function expectEditorFocused(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return Boolean(active?.isContentEditable || active?.closest('[contenteditable="true"]'))
  }), { timeout: 5_000 }).toBe(true)
}

async function createUntitledNote(page: Page): Promise<void> {
  await page.locator('body').click()
  await triggerMenuCommand(page, 'file-new-note')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+(?:-\d+)?/i, {
    timeout: 5_000,
  })
  await expectEditorFocused(page)
}

async function expectActiveFilename(page: Page, { title }: TitleInput): Promise<void> {
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(slugifyTitle({ title }), {
    timeout: 10_000,
  })
}

async function expectFileContentContains(expectation: FileContentExpectation): Promise<void> {
  await expect(async () => {
    expect(markdownFiles(expectation)).toContain(expectation.filename)
    expect(fs.readFileSync(`${expectation.vaultPath}/${expectation.filename}`, 'utf-8')).toContain(expectation.text)
  }).toPass({ timeout: 10_000 })
}

async function dispatchRichHeadingPaste(page: Page, payload: RichHeadingPastePayload): Promise<void> {
  await page.evaluate(({ htmlFragment, textFragment }) => {
    const target = document.querySelector<HTMLElement>(
      [
        '.bn-editor [data-content-type="heading"][data-level="1"] .bn-inline-content',
        '.bn-editor [data-content-type="heading"]:not([data-level]) .bn-inline-content',
        '.bn-editor h1',
      ].join(', '),
    )
    if (!target) throw new Error('Title heading paste target was not found')

    const clipboardData = new DataTransfer()
    clipboardData.setData('text/html', htmlFragment)
    clipboardData.setData('text/plain', textFragment)

    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: clipboardData })

    if (target.dispatchEvent(event)) {
      throw new Error('Rich title-heading paste was not intercepted')
    }
  }, { htmlFragment: payload.html, textFragment: payload.text })
}

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultTauri(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('new-note first typing and rich heading paste remain stable through saves', async ({ page }) => {
  const crashMessages = collectEditorCrashMessages(page)
  const title = 'Sentry Fresh Paste Guard'
  const filename = `${slugifyTitle({ title })}.md`

  await createUntitledNote(page)
  await page.keyboard.type(title, { delay: 30 })
  await page.keyboard.press('Enter')
  await page.keyboard.type('Initial body text survives the create-note save.', { delay: 30 })
  await expectActiveFilename(page, { title })
  await expectFileContentContains({
    vaultPath: tempVaultDir,
    filename,
    text: 'Initial body text survives the create-note save.',
  })

  const titleHeading = page.locator('.bn-editor [data-content-type="heading"]').first()
  await titleHeading.click()
  await page.keyboard.press('End')
  await dispatchRichHeadingPaste(page, {
    text: ' Rich Paste Payload',
    html: '<h1>Rich <em>Paste</em> Payload</h1><table><tr><td>structured</td></tr></table>',
  })
  await expect(titleHeading).toContainText('Sentry Fresh Paste Guard Rich Paste Payload')

  await page.keyboard.press('Enter')
  await page.keyboard.type('Editing continues after the heading paste.', { delay: 30 })
  await triggerMenuCommand(page, 'file-save')

  await expectFileContentContains({
    vaultPath: tempVaultDir,
    filename,
    text: '# Sentry Fresh Paste Guard Rich Paste Payload',
  })
  await expectFileContentContains({
    vaultPath: tempVaultDir,
    filename,
    text: 'Editing continues after the heading paste.',
  })
  expect(crashMessages).toEqual([])
})
