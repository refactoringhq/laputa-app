import { test, expect, type Page } from '@playwright/test'

const SOURCE_NOTE_TITLE = 'Grow Newsletter'
const INSERTED_WIKILINK_QUERY = '[[Mana'
const INSERTED_WIKILINK_TITLE = 'Manage Sponsorships'
const INSERTED_WIKILINK_TARGET = 'manage-sponsorships'

async function insertWikilink(page: Page) {
  const editor = page.locator('.bn-editor')
  await expect(editor).toBeVisible({ timeout: 5000 })

  const firstParagraph = editor.locator('p').first()
  await expect(
    firstParagraph,
  ).toContainText('Build a sustainable audience through high-quality weekly essays', { timeout: 5000 })
  const firstParagraphBox = await firstParagraph.boundingBox()
  if (!firstParagraphBox) throw new Error('Source paragraph is not visible')

  await firstParagraph.click({
    position: {
      x: Math.max(1, firstParagraphBox.width - 2),
      y: Math.max(1, firstParagraphBox.height - 2),
    },
  })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)

  await page.keyboard.type(INSERTED_WIKILINK_QUERY)

  const suggestionMenu = page.locator('.wikilink-menu')
  await expect(suggestionMenu).toBeVisible({ timeout: 5000 })
  const matchingWikilinks = editor.locator(`.wikilink[data-target="${INSERTED_WIKILINK_TARGET}"]`)
  const existingCount = await matchingWikilinks.count()
  await expect(suggestionMenu.getByText(INSERTED_WIKILINK_TITLE, { exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)

  await expect(matchingWikilinks).toHaveCount(existingCount + 1)
  return matchingWikilinks.nth(existingCount)
}

test.describe('Wikilink insertion and navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))
    await page.goto('/')
    await page.waitForTimeout(500)

    const noteItem = page.locator('.app__note-list .cursor-pointer').filter({ hasText: SOURCE_NOTE_TITLE }).first()
    await noteItem.click()
    await page.waitForTimeout(1000)
  })

  test('[[ autocomplete inserts wikilink that is not broken', async ({ page }) => {
    const wikilink = await insertWikilink(page)

    const isBroken = await wikilink.evaluate(
      el => el.classList.contains('wikilink--broken'),
    )
    expect(isBroken).toBe(false)

    const target = await wikilink.getAttribute('data-target')
    expect(target).toBeTruthy()
  })

  test('@smoke Cmd+clicking an inserted wikilink navigates to the note', async ({ page }) => {
    const wikilink = await insertWikilink(page)
    await expect(wikilink).toBeVisible()

    await wikilink.click({ modifiers: ['Meta'] })
    await expect(page.locator('.bn-editor h1').first()).toHaveText(INSERTED_WIKILINK_TITLE, { timeout: 5000 })
  })
})
