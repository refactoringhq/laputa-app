import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { executeCommand, openCommandPalette, sendShortcut } from './helpers'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

function seedBodyTemplateTypeEntry(vaultPath: string, typeName: string, template: string): void {
  const slug = typeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'type'
  const body = [
    '---',
    'type: Type',
    '---',
    '',
    `# ${typeName}`,
    '',
    template,
  ].join('\n')
  fs.writeFileSync(path.join(vaultPath, `${slug}.md`), body)
}

async function openTestVault(page: Page): Promise<void> {
  await openFixtureVault(page, tempVaultDir)
}

async function selectSection(page: Page, label: string): Promise<void> {
  await page.locator('aside').getByText(label, { exact: true }).first().click()
}

async function createNoteFromListHeader(page: Page): Promise<void> {
  await page.locator('button[title="Create new note"]').click()
}

function untitledRow(page: Page, typeLabel: string) {
  return page.getByText(new RegExp(`^Untitled ${typeLabel}(?: \\d+)?$`, 'i')).first()
}

type EmptyHeadingState = {
  contentType: string | null
  editorFocused: boolean
  placeholder: string | null
}

function capturePageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

async function readEmptyHeadingState(page: Page): Promise<EmptyHeadingState> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    const firstBlock = document.querySelector('.bn-block-content') as HTMLElement | null
    const inlineHeading = firstBlock?.querySelector('.bn-inline-content') as HTMLElement | null
    return {
      contentType: firstBlock?.getAttribute('data-content-type') ?? null,
      editorFocused: Boolean(active?.isContentEditable || active?.closest('[contenteditable="true"]')),
      placeholder: inlineHeading ? getComputedStyle(inlineHeading, '::before').content : null,
    }
  })
}

function hasExpectedTitlePlaceholder(placeholder: string | null): boolean {
  return placeholder === '"Heading"' || placeholder === '"Title"'
}

function isReadyEmptyTitleHeading(state: EmptyHeadingState): boolean {
  return state.editorFocused && state.contentType === 'heading' && hasExpectedTitlePlaceholder(state.placeholder)
}

async function expectReadyEmptyTitleHeading(page: Page): Promise<void> {
  await expect.poll(async () => isReadyEmptyTitleHeading(await readEmptyHeadingState(page)), {
    timeout: 5_000,
  }).toBe(true)
}

async function expectUntitledNoteWithoutCrash(
  page: Page,
  typeLabel: string,
  createNote: () => Promise<void>,
): Promise<void> {
  const errors = capturePageErrors(page)

  await createNote()
  await expect(untitledRow(page, typeLabel)).toBeVisible({ timeout: 5_000 })
  await expectReadyEmptyTitleHeading(page)

  expect(errors).toEqual([])
}

test.describe('Create note crash fix', () => {
  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('clicking + next to a type section creates a note without crashing @smoke', async ({ page }) => {
    await openTestVault(page)
    await selectSection(page, 'Projects')
    await expectUntitledNoteWithoutCrash(page, 'project', async () => {
      await createNoteFromListHeader(page)
    })
  })

  test('Cmd+N creates a note without crashing @smoke', async ({ page }) => {
    await openTestVault(page)
    await expectUntitledNoteWithoutCrash(page, 'note', async () => {
      await page.waitForTimeout(300)
      await page.locator('body').click()
      await sendShortcut(page, 'n', ['Control'])
    })
  })

  test('creating note for custom type does not crash', async ({ page }) => {
    await openTestVault(page)
    await selectSection(page, 'Events')
    await expectUntitledNoteWithoutCrash(page, 'event', async () => {
      await createNoteFromListHeader(page)
    })
  })

  test('command palette creates typed notes from a Type body template @smoke', async ({ page }) => {
    seedBodyTemplateTypeEntry(tempVaultDir, 'Procedure', '## Checklist\n\n- first step\n- [[Alpha Project]]\n- unmatched [link')
    await openTestVault(page)
    await expectUntitledNoteWithoutCrash(page, 'procedure', async () => {
      await openCommandPalette(page)
      await executeCommand(page, 'new procedure')
    })

    await openCommandPalette(page)
    await executeCommand(page, 'Toggle Raw')
    const rawEditor = page.locator('.cm-content')
    await expect(rawEditor).toContainText('## Checklist')
    await expect(rawEditor).toContainText('[[Alpha Project]]')
  })
})
