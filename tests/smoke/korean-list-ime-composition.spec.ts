import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string) {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function createBulletListItem(page: Page) {
  await page.locator('.bn-block-content').nth(1).click()
  await page.keyboard.type('/bul')
  await expect(page.getByRole('option', { name: /Bullet List/i })).toBeVisible()
  await page.keyboard.press('Enter')

  const bullet = page.locator('.bn-block-content[data-content-type="bulletListItem"]').last()
  await expect(bullet).toBeVisible()
  return bullet
}

test('composing Enter inside a Korean bullet item does not split the list item', async ({ page }) => {
  await openNote(page, 'Note B')
  const bullet = await createBulletListItem(page)
  await page.keyboard.type('한글 시작')
  await expect(bullet).toContainText('한글 시작')

  const bulletCountBefore = await page.locator('.bn-block-content[data-content-type="bulletListItem"]').count()
  const dispatchResult = await bullet.evaluate((element) => {
    const editor = document.querySelector('.bn-editor')
    let reachedEditorBubble = false
    const handleKeydown = () => {
      reachedEditorBubble = true
    }

    editor?.addEventListener('keydown', handleKeydown, { once: true })
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Enter',
      key: 'Enter',
    })
    Object.defineProperty(event, 'isComposing', { value: true })
    element.dispatchEvent(event)
    editor?.removeEventListener('keydown', handleKeydown)

    return {
      defaultPrevented: event.defaultPrevented,
      reachedEditorBubble,
    }
  })

  expect(dispatchResult).toEqual({
    defaultPrevented: false,
    reachedEditorBubble: false,
  })
  await expect(page.locator('.bn-block-content[data-content-type="bulletListItem"]')).toHaveCount(
    bulletCountBefore,
  )

  await page.keyboard.type(' 계속')
  await expect(bullet).toContainText('한글 시작 계속')
})
