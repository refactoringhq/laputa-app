import { expect, test, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
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

test('slash command inserts a sandboxed resizable HTML block that persists as fenced markdown', async ({ page }) => {
  await openNote(page, 'Note B')
  await page.locator('.bn-block-content').last().click()
  await page.keyboard.press('Enter')
  await page.keyboard.type('/html')
  await page.getByRole('option', { name: /HTML block/i }).click()

  const source = page.getByLabel('HTML source')
  await expect(source).toBeVisible({ timeout: 5_000 })
  await source.fill('<button>Static button</button>')
  await source.press('Control+Enter')

  const frame = page.locator('.html-block__frame')
  await expect(frame).toBeVisible({ timeout: 5_000 })
  await expect(frame).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox')
  await expect(frame).not.toHaveAttribute('sandbox', /allow-scripts/)
  await expect(frame).not.toHaveAttribute('sandbox', /allow-same-origin/)
  await expect(frame).toHaveAttribute('srcdoc', /<button>Static button<\/button>/)

  await page.getByRole('button', { name: 'Resize height' }).press('ArrowDown')
  await openRawMode(page)

  const raw = await getRawEditorContent(page)
  expect(raw).toContain('```html height="344"')
  expect(raw).toContain('<button>Static button</button>')
})
