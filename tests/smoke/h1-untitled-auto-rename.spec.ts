import fs from 'fs'
import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

function markdownFiles(vaultPath: string): string[] {
  return fs.readdirSync(vaultPath).filter((name) => name.endsWith('.md')).sort()
}

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

interface FileExpectation {
  vaultPath: string
  filename: string
}

interface FileContentExpectation extends FileExpectation {
  text: string
}

interface EmptyTitleHeadingState {
  contentType: string | null
  placeholder: string | null
}

async function createUntitledNote(page: Page): Promise<void> {
  await page.locator('body').click()
  await triggerMenuCommand(page, 'file-new-note')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+(?:-\d+)?/i, {
    timeout: 5_000,
  })
  await expectStableEmptyTitleHeading(page)
}

async function writeNewHeading(page: Page, title: string): Promise<void> {
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
}

async function writeNewHeadingAndBody(page: Page, title: string, body: string): Promise<void> {
  await page.keyboard.type(title, { delay: 20 })
  await page.keyboard.press('Enter')
  await page.keyboard.type(body, { delay: 20 })
}

async function expectRenamedFile({ vaultPath, filename }: FileExpectation): Promise<void> {
  await expect(async () => {
    expect(markdownFiles(vaultPath)).toContain(filename)
  }).toPass({ timeout: 10_000 })
}

async function expectFileMissing({ vaultPath, filename }: FileExpectation): Promise<void> {
  await expect(async () => {
    expect(markdownFiles(vaultPath)).not.toContain(filename)
  }).toPass({ timeout: 10_000 })
}

async function expectFileContentContains({ vaultPath, filename, text }: FileContentExpectation): Promise<void> {
  await expect(async () => {
    const content = fs.readFileSync(`${vaultPath}/${filename}`, 'utf-8')
    expect(content).toContain(text)
  }).toPass({ timeout: 10_000 })
}

async function expectActiveFilename(page: Page, filenameStem: string): Promise<void> {
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(filenameStem, { timeout: 10_000 })
}

async function expectEditorFocused(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return Boolean(active?.isContentEditable || active?.closest('[contenteditable="true"]'))
  }), {
    timeout: 5_000,
  }).toBe(true)
}

async function readEmptyTitleHeadingState(page: Page): Promise<EmptyTitleHeadingState> {
  return page.evaluate(() => {
    const firstBlock = document.querySelector('.bn-block-content') as HTMLElement | null
    const inlineHeading = firstBlock?.querySelector('.bn-inline-content') as HTMLElement | null
    return {
      contentType: firstBlock?.getAttribute('data-content-type') ?? null,
      placeholder: inlineHeading ? getComputedStyle(inlineHeading, '::before').content : null,
    }
  })
}

async function selectionInsideEmptyTitleHeading(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const firstBlock = document.querySelector('.bn-block-content') as HTMLElement | null
    const selection = window.getSelection()
    const anchorNode = selection?.anchorNode ?? null
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null
    return Boolean(selection?.rangeCount && anchorElement && firstBlock?.contains(anchorElement))
  })
}

async function expectReadyEmptyTitleHeading(page: Page): Promise<void> {
  await expectEditorFocused(page)
  await expect.poll(() => readEmptyTitleHeadingState(page), {
    timeout: 5_000,
  }).toEqual({
    contentType: 'heading',
    placeholder: '"Title"',
  })
  await expect.poll(() => selectionInsideEmptyTitleHeading(page), { timeout: 5_000 }).toBe(true)
}

async function expectStableEmptyTitleHeading(page: Page): Promise<void> {
  await expectReadyEmptyTitleHeading(page)
  await page.waitForTimeout(300)
  await expectReadyEmptyTitleHeading(page)
}

async function activeSelectionBlockType(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const selection = window.getSelection()
    const anchorNode = selection?.anchorNode ?? null
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null
    return anchorElement?.closest('.bn-block-content')?.getAttribute('data-content-type') ?? null
  })
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

test('@smoke new-note H1 auto-rename keeps the editor usable and leaves no untitled duplicates', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => {
    errors.push(err.message)
  })

  const titles = [
    'Fresh Focus Title',
    'Rapid Rename 2',
    'Rapid Rename 3',
    'Rapid Rename 4',
    'Rapid Rename 5',
  ]

  for (const [index, title] of titles.entries()) {
    await createUntitledNote(page)
    if (index === 0) {
      await writeNewHeadingAndBody(page, title, 'Body continues while rename is pending.')
    } else {
      await writeNewHeading(page, title)
    }
    await expectActiveFilename(page, slugifyTitle(title))
    await expectRenamedFile({ vaultPath: tempVaultDir, filename: `${slugifyTitle(title)}.md` })
    await expectEditorFocused(page)
    await expectFileContentContains({
      vaultPath: tempVaultDir,
      filename: `${slugifyTitle(title)}.md`,
      text: `# ${title}`,
    })

    if (index === 0) {
      await expectFileContentContains({
        vaultPath: tempVaultDir,
        filename: 'fresh-focus-title.md',
        text: 'Body continues while rename is pending.',
      })
      await page.keyboard.type(' focus-probe')
      await expectFileContentContains({
        vaultPath: tempVaultDir,
        filename: 'fresh-focus-title.md',
        text: 'focus-probe',
      })
    }
  }

  const files = markdownFiles(tempVaultDir)
  expect(files).toContain('fresh-focus-title.md')
  expect(files.filter((name) => name.startsWith('untitled-note-'))).toEqual([])
  expect(files.filter((name) => /^rapid-rename-\d+\.md$/.test(name))).toHaveLength(4)
  expect(errors).toEqual([])
})

test('@smoke new-note typing stays focused through initial save settlement', async ({ page }) => {
  const title = 'Creation Focus Guard'
  const bodyText = 'Body keeps accepting text while creation writes and saves settle.'

  await createUntitledNote(page)
  await page.keyboard.type(title, { delay: 35 })
  await page.keyboard.press('Enter')
  await page.keyboard.type(bodyText, { delay: 35 })
  await page.waitForTimeout(1_000)

  await expectEditorFocused(page)
  await page.keyboard.type(' Still focused.')
  await expectActiveFilename(page, slugifyTitle(title))
  await expectFileContentContains({
    vaultPath: tempVaultDir,
    filename: `${slugifyTitle(title)}.md`,
    text: 'Still focused.',
  })
})

test('@smoke new-note H1 auto-rename preserves body typing and cursor while rename lands', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => {
    errors.push(err.message)
  })

  await createUntitledNote(page)
  await page.keyboard.type('Cursor Stable Rename', { delay: 30 })
  await page.keyboard.press('Enter')

  // Let the initial untitled save settle so the rename timer can fire mid-body typing.
  await page.waitForTimeout(700)

  const bodyText = 'Body keeps flowing through the rename without losing the caret or freezing.'
  await page.keyboard.type(bodyText, { delay: 70 })

  await expectActiveFilename(page, 'cursor-stable-rename')
  await expectRenamedFile({ vaultPath: tempVaultDir, filename: 'cursor-stable-rename.md' })
  await expectFileContentContains({
    vaultPath: tempVaultDir,
    filename: 'cursor-stable-rename.md',
    text: bodyText,
  })
  await expectEditorFocused(page)
  await expect.poll(() => activeSelectionBlockType(page), { timeout: 5_000 }).toBe('paragraph')

  await page.keyboard.type(' Still typing after rename.')
  await expectFileContentContains({
    vaultPath: tempVaultDir,
    filename: 'cursor-stable-rename.md',
    text: 'Still typing after rename.',
  })
  await expectEditorFocused(page)
  await expect(errors).toEqual([])
})

test('@smoke new-note H1 auto-rename does not recreate the untitled file when a buffered save lands after rename', async ({ page }) => {
  const title = 'Late Save Guard'
  const lateBody = 'Body typed right before rename'

  await createUntitledNote(page)
  const untitledStem = (await page.getByTestId('breadcrumb-filename-trigger').textContent())?.trim()
  expect(untitledStem).toMatch(/^untitled-note-\d+(?:-\d+)?$/i)

  await writeNewHeading(page, title)
  await page.waitForTimeout(2_600)
  await page.keyboard.type(lateBody)

  await expectActiveFilename(page, 'late-save-guard')
  await expectRenamedFile({ vaultPath: tempVaultDir, filename: 'late-save-guard.md' })
  await expectFileContentContains({
    vaultPath: tempVaultDir,
    filename: 'late-save-guard.md',
    text: lateBody,
  })

  await page.waitForTimeout(800)
  await expectFileMissing({
    vaultPath: tempVaultDir,
    filename: `${untitledStem}.md`,
  })
})
