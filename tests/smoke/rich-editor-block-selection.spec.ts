import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

const BLOCK_SELECTION = '.tolaria-rich-editor-block-selected'
const MOD_SHIFT_ARROW_DOWN = process.platform === 'darwin'
  ? 'Meta+Shift+ArrowDown'
  : 'Control+Shift+ArrowDown'
const MOD_SHIFT_ARROW_UP = process.platform === 'darwin'
  ? 'Meta+Shift+ArrowUp'
  : 'Control+Shift+ArrowUp'
const PROJECT_BODY = 'This is a test project that references other notes.'
const PROJECT_NOTES_HEADING = 'Notes'
const PROJECT_NOTES_BODY = 'See Note B for details and Note C for additional context.'

let tempVaultDir: string

async function openAlphaProject(page: Page): Promise<void> {
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
  await page.getByText('Alpha Project', { exact: true }).first().click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function focusBlock(page: Page, text: string): Promise<void> {
  const block = page.locator('.bn-block-content').filter({ hasText: text }).first()
  await expect(block).toBeVisible({ timeout: 5_000 })
  await block.click()
}

async function selectTextRange(page: Page, fromText: string, toText: string): Promise<void> {
  await page.evaluate(({ fromText, toText }) => {
    const textNodeContaining = (needle: string): Text => {
      const walker = document.createTreeWalker(
        document.querySelector('.bn-editor') ?? document.body,
        NodeFilter.SHOW_TEXT,
      )

      let node = walker.nextNode()
      while (node) {
        if (node.textContent?.includes(needle)) return node as Text
        node = walker.nextNode()
      }

      throw new Error(`Unable to find editor text node containing "${needle}"`)
    }

    const start = textNodeContaining(fromText)
    const end = textNodeContaining(toText)
    const range = document.createRange()
    range.setStart(start, 0)
    range.setEnd(end, end.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, { fromText, toText })
}

test.describe('rich editor block selection', () => {
  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('Escape selects the current block before app-level note-list navigation takes over', async ({ page }) => {
    await openAlphaProject(page)
    await focusBlock(page, PROJECT_BODY)

    await page.keyboard.press('Escape')
    await expect(page.locator(BLOCK_SELECTION)).toHaveCount(1)
    await expect(page.locator(BLOCK_SELECTION).first()).toContainText(PROJECT_BODY)

    await page.keyboard.press('ArrowDown')
    await expect(page.locator(BLOCK_SELECTION)).toHaveCount(1)
    await expect(page.locator(BLOCK_SELECTION).first()).toContainText(PROJECT_NOTES_HEADING)

    await page.keyboard.press('Shift+ArrowDown')
    await expect(page.locator(BLOCK_SELECTION)).toHaveCount(2)
    await expect(page.locator(BLOCK_SELECTION).last()).toContainText(PROJECT_NOTES_BODY)

    await page.keyboard.press('Escape')
    await expect(page.locator(BLOCK_SELECTION)).toHaveCount(0)
  })

  test('Escape promotes a native multi-block text selection into block selection chrome', async ({ page }) => {
    await openAlphaProject(page)
    await focusBlock(page, PROJECT_BODY)
    await selectTextRange(page, PROJECT_BODY, PROJECT_NOTES_HEADING)

    await page.keyboard.press('Escape')

    await expect(page.locator(BLOCK_SELECTION)).toHaveCount(2)
    await expect(page.locator(BLOCK_SELECTION).first()).toContainText(PROJECT_BODY)
    await expect(page.locator(BLOCK_SELECTION).last()).toContainText(PROJECT_NOTES_HEADING)
  })

  test('Mod+Shift+Arrow moves a selected block without dropping block selection', async ({ page }) => {
    await openAlphaProject(page)
    await focusBlock(page, PROJECT_BODY)

    await page.keyboard.press('Escape')
    await page.keyboard.press(MOD_SHIFT_ARROW_DOWN)
    await expect(page.locator(BLOCK_SELECTION)).toHaveCount(1)
    await expect(page.locator(BLOCK_SELECTION).first()).toContainText(PROJECT_BODY)

    await page.keyboard.press(MOD_SHIFT_ARROW_UP)
    await expect(page.locator(BLOCK_SELECTION)).toHaveCount(1)
    await expect(page.locator(BLOCK_SELECTION).first()).toContainText(PROJECT_BODY)
  })
})
