import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { dispatchShortcutEvent } from './testBridge'

const USE_META_SHORTCUTS = process.platform === 'darwin'
const CRLF_INBOX_NOTE_RELATIVE_PATH = path.join('note', 'crlf-inbox-syntax.md')

let tempVaultDir: string

function crlfInboxNotePath() {
  return path.join(tempVaultDir, CRLF_INBOX_NOTE_RELATIVE_PATH)
}

function seedCrlfInboxNote() {
  fs.writeFileSync(
    crlfInboxNotePath(),
    [
      '---',
      'type: Note',
      'related_to: "[[Alpha Project]]"',
      '---',
      '# CRLF Inbox Syntax',
      '',
      'This note should remain visible after organize.',
      '',
    ].join('\r\n'),
  )
}

function frontmatterDelimiterLineCount(content: string): number {
  return content.split(/\r?\n/).filter((line) => line === '---').length
}

async function focusNoteList(page: Page) {
  const container = page.getByTestId('note-list-container')
  await container.focus()
  await expect(container).toBeFocused()
}

async function dispatchCommandShortcut(page: Page, key: string, code: string) {
  await dispatchShortcutEvent(page, {
    key,
    code,
    metaKey: USE_META_SHORTCUTS,
    ctrlKey: !USE_META_SHORTCUTS,
    shiftKey: false,
    altKey: false,
    bubbles: true,
    cancelable: true,
  })
}

async function selectVisibleInboxBatch(page: Page) {
  await focusNoteList(page)
  await dispatchCommandShortcut(page, 'a', 'KeyA')
  await expect(page.getByTestId('bulk-action-bar')).toBeVisible({ timeout: 5_000 })
}

async function selectTopNav(page: Page, label: string) {
  await page.getByTestId('sidebar-top-nav').getByText(label, { exact: true }).click()
}

async function openCrlfInboxNote(page: Page) {
  await selectTopNav(page, 'Inbox')
  const noteRow = page.locator(`[data-note-path="${crlfInboxNotePath()}"]`)
  await expect(noteRow).toBeVisible({ timeout: 5_000 })
  await noteRow.click()
  await expect(page.getByRole('heading', { name: 'CRLF Inbox Syntax', level: 1 })).toBeVisible({ timeout: 5_000 })
}

test.describe('multi-selection shortcuts', () => {
  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('Cmd/Ctrl+E organizes the full Inbox multi-selection @smoke', async ({ page }) => {
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await selectVisibleInboxBatch(page)

    await dispatchCommandShortcut(page, 'e', 'KeyE')

    await expect(page.getByTestId('bulk-action-bar')).toHaveCount(0)
    await expect(page.getByText('All notes are organized')).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd/Ctrl+E organizes a CRLF Inbox note without duplicating frontmatter @smoke', async ({ page }) => {
    seedCrlfInboxNote()
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await openCrlfInboxNote(page)

    await page.locator('.bn-editor').click()
    await dispatchCommandShortcut(page, 'e', 'KeyE')

    await expect.poll(() => fs.readFileSync(crlfInboxNotePath(), 'utf8')).toContain('_organized: true')
    const organizedContent = fs.readFileSync(crlfInboxNotePath(), 'utf8')
    expect(frontmatterDelimiterLineCount(organizedContent)).toBe(2)
    expect(organizedContent).toContain('type: Note')
    expect(organizedContent).toContain('related_to: "[[Alpha Project]]"')

    await expect(page.locator(`[data-note-path="${crlfInboxNotePath()}"]`)).toHaveCount(0)
    await selectTopNav(page, 'All Notes')
    await expect(page.locator(`[data-note-path="${crlfInboxNotePath()}"]`)).toBeVisible({ timeout: 5_000 })
  })

  test('Cmd/Ctrl+Backspace batch-deletes the full visible multi-selection after one confirmation @smoke', async ({ page }) => {
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await selectVisibleInboxBatch(page)

    await dispatchCommandShortcut(page, 'Backspace', 'Backspace')

    const dialog = page.getByTestId('confirm-delete-dialog')
    const confirmButton = page.getByTestId('confirm-delete-btn')
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await expect(dialog).toContainText(/Delete \d+ notes permanently\?/)

    await expect(confirmButton).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('bulk-action-bar')).toHaveCount(0)
  })
})
