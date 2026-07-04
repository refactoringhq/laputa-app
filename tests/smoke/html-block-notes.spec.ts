import { expect, test, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { triggerShortcutCommand } from './testBridge'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string) {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function openRawMode(page: Page) {
  await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 })
}

async function openBlockNoteMode(page: Page) {
  await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function getRawEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    type CodeMirrorHost = Element & {
      cmTile?: {
        view?: {
          state: {
            doc: {
              toString(): string
            }
          }
        }
      }
    }

    const el = document.querySelector('.cm-content')
    const view = el ? (el as CodeMirrorHost).cmTile?.view : null
    return view?.state.doc.toString() ?? el?.textContent ?? ''
  })
}

async function getActiveFocusScope(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return 'none'
    if (active.classList.contains('html-block__frame')) return 'iframe'
    if (active.closest('.bn-editor')) return 'editor'
    return active.tagName.toLowerCase()
  })
}

async function setRawEditorContent(page: Page, content: string): Promise<void> {
  await page.evaluate((nextContent) => {
    type CodeMirrorHost = Element & {
      cmTile?: {
        view?: {
          state: {
            doc: {
              length: number
            }
          }
          dispatch(update: {
            changes: {
              from: number
              to: number
              insert: string
            }
          }): void
        }
      }
    }

    const el = document.querySelector('.cm-content') as CodeMirrorHost | null
    const view = el?.cmTile?.view
    if (!view) {
      throw new Error('CodeMirror view is missing')
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextContent },
    })
  }, content)
}

function withHtmlBlockSource(raw: string, fencedHtml: string): string {
  const emptyHtmlFence = /```html[^\n]*\n\s*```/u
  if (emptyHtmlFence.test(raw)) return raw.replace(emptyHtmlFence, fencedHtml)
  return `${raw.trimEnd()}\n\n${fencedHtml}\n`
}

test('slash command inserts a sandboxed HTML block whose source is edited in raw mode', async ({ page }) => {
  await openNote(page, 'Note B')
  await page.locator('.bn-block-content').last().click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('/html')
  await page.getByRole('option', { name: /HTML block/i }).click()

  const htmlBlock = page.locator('[data-html-block]').last()
  await expect(htmlBlock).toBeVisible({ timeout: 5_000 })
  await expect(page.getByLabel('HTML source')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Edit source' })).toHaveCount(0)

  await page.mouse.move(1, 1)
  await expect.poll(() =>
    htmlBlock.evaluate(element => getComputedStyle(element).borderTopColor),
  ).toBe('rgba(0, 0, 0, 0)')

  await htmlBlock.hover()
  await expect.poll(async () =>
    (await htmlBlock.evaluate(element => getComputedStyle(element).borderTopColor)) !== 'rgba(0, 0, 0, 0)',
  ).toBe(true)

  await page.getByRole('button', { name: 'Open raw editor' }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 })

  const fencedHtml = '```html height="344"\n<button>Static button</button>\n```'
  await setRawEditorContent(page, withHtmlBlockSource(await getRawEditorContent(page), fencedHtml))
  await page.waitForTimeout(600)
  await openBlockNoteMode(page)

  const frame = page.locator('.html-block__frame')
  await expect(frame).toBeVisible({ timeout: 5_000 })
  await expect(frame).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
  await expect(frame).not.toHaveAttribute('sandbox', /allow-scripts/)
  await expect(frame).not.toHaveAttribute('sandbox', /allow-same-origin/)
  await expect(frame).toHaveAttribute('srcdoc', /<button>Static button<\/button>/)

  const openPropertiesButton = page.getByRole('button', { name: 'Open the properties panel' })
  await expect(openPropertiesButton).toBeVisible({ timeout: 5_000 })

  await frame.click()
  await expect.poll(() => getActiveFocusScope(page)).toBe('editor')

  await page.keyboard.press('Escape')
  await expect.poll(() => getActiveFocusScope(page)).toBe('editor')

  await triggerShortcutCommand(page, APP_COMMAND_IDS.viewToggleProperties)
  await expect(openPropertiesButton).toHaveCount(0)

  await openRawMode(page)

  const raw = await getRawEditorContent(page)
  expect(raw).toContain('```html height="344"')
  expect(raw).toContain('<button>Static button</button>')
})
