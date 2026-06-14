import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette, sendShortcut } from './helpers'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string) {
  const noteList = page.locator('[data-testid="note-list-container"]')
  await noteList.getByText(title, { exact: true }).click()
}

async function openRawMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 })
}

async function openBlockNoteMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
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
  await page.evaluate((newContent) => {
    const el = document.querySelector('.cm-content')
    if (!el) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = (el as any).cmTile?.view
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: newContent },
    })
  }, content)
}

async function openQuickOpen(page: Page) {
  await page.locator('body').click()
  await sendShortcut(page, 'p', ['Control'])
  await expect(page.locator('input[placeholder="Search notes..."]')).toBeVisible({ timeout: 5_000 })
}

function quickOpenSelectedTitle(page: Page) {
  return page.getByTestId('quick-open-palette').locator('[class*="bg-accent"] span.truncate').first()
}

async function focusHeadingEnd(page: Page, title: string) {
  const heading = page.getByRole('heading', { name: title, level: 1 })
  await expect(heading).toBeVisible({ timeout: 5_000 })
  await heading.click()
  await page.keyboard.press('End')
}

async function appendWikilinkQuery(page: Page, query: string) {
  const lastBlock = page.locator('.bn-block-content').last()
  await expect(lastBlock).toBeVisible({ timeout: 5_000 })
  await lastBlock.click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type(query)
}

test('creating an untitled draft hides the legacy title section in the editor', async ({ page }) => {
  await page.locator('button[title="Create new note"]').click()

  await expect(page.getByRole('textbox').last()).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('title-field-input')).toHaveCount(0)
  await expect(page.locator('.title-section[data-title-ui-visible]')).toHaveCount(0)
})

test('older notes with a document title do not render the legacy title section', async ({ page }) => {
  await openNote(page, 'Alpha Project')

  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('title-field-input')).toHaveCount(0)
  await expect(page.locator('.title-section[data-title-ui-visible]')).toHaveCount(0)

  await openNote(page, 'Spring 2026')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('title-field-input')).toHaveCount(0)
  await expect(page.locator('.title-section[data-title-ui-visible]')).toHaveCount(0)
})

test('deleting the H1 does not resurrect the legacy title section', async ({ page }) => {
  await openNote(page, 'Alpha Project')
  await openRawMode(page)

  const rawContent = await getRawEditorContent(page)
  expect(rawContent).toContain('# Alpha Project')

  await setRawEditorContent(page, rawContent.replace('# Alpha Project\n\n', ''))
  await page.keyboard.press('Meta+s')
  await openBlockNoteMode(page)

  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('title-field-input')).toHaveCount(0)
  await expect(page.locator('.title-section')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Alpha Project', level: 1 })).toHaveCount(0)
})

test('edited H1 titles drive note list, search, and wikilink autocomplete', async ({ page }) => {
  const updatedTitle = 'Updated Display Title'
  const noteList = page.locator('[data-testid="note-list-container"]')

  await openNote(page, 'Note B')
  await openRawMode(page)

  const rawContent = await getRawEditorContent(page)
  expect(rawContent).toContain('# Note B')

  await setRawEditorContent(page, rawContent.replace('# Note B', `# ${updatedTitle}`))
  await page.waitForTimeout(700)
  await page.keyboard.press('Meta+s')
  await openBlockNoteMode(page)

  await expect(page.getByRole('heading', { name: updatedTitle, level: 1 })).toBeVisible({ timeout: 5_000 })
  await expect(noteList.getByText(updatedTitle, { exact: true })).toBeVisible({ timeout: 5_000 })
  await expect(noteList.getByText('Note B', { exact: true })).toHaveCount(0)

  await openQuickOpen(page)
  const quickOpenInput = page.locator('input[placeholder="Search notes..."]')
  await quickOpenInput.fill(updatedTitle)
  await expect(quickOpenSelectedTitle(page)).toHaveText(updatedTitle, { timeout: 5_000 })
  await page.keyboard.press('Escape')

  await openNote(page, 'Alpha Project')
  await appendWikilinkQuery(page, '[[Up')

  const suggestionMenu = page.locator('.wikilink-menu')
  await expect(suggestionMenu).toContainText(updatedTitle, { timeout: 5_000 })
})

test('rapid H1 typing stays stable while editing an existing note', async ({ page }) => {
  const noteList = page.locator('[data-testid="note-list-container"]')
  const firstTitle = 'Alpha Project Fast Typing Check'
  const finalTitle = 'Alpha Project Fast Typing Flow'

  await openNote(page, 'Alpha Project')
  await focusHeadingEnd(page, 'Alpha Project')
  await page.keyboard.type(' Fast Typing Check')

  await expect(page.getByRole('heading', { name: firstTitle, level: 1 })).toBeVisible({ timeout: 5_000 })

  for (let i = 0; i < ' Check'.length; i += 1) {
    await page.keyboard.press('Backspace')
  }
  await page.keyboard.type(' Flow')
  await page.keyboard.press('Meta+s')

  await expect(page.getByRole('heading', { name: finalTitle, level: 1 })).toBeVisible({ timeout: 5_000 })
  await expect(noteList.getByText(finalTitle, { exact: true })).toBeVisible({ timeout: 5_000 })
  await expect(noteList.getByText('Alpha Project', { exact: true })).toHaveCount(0)

  await openNote(page, 'Spring 2026')
  await openNote(page, finalTitle)
  await expect(page.getByRole('heading', { name: finalTitle, level: 1 })).toBeVisible({ timeout: 5_000 })
})
