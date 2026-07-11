import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

const SOURCE_NOTE_TITLE = 'Grow Newsletter'
const INSERTED_WIKILINK_QUERY = '[[Mana'
const INSERTED_WIKILINK_TITLE = 'Manage Sponsorships'
const INSERTED_WIKILINK_TARGET = 'manage-sponsorships'
const MARKDOWN_LINK_NOTE_TITLE = 'Markdown Link Jump'

let tempVaultDir: string | null = null

async function insertWikilink(page: Page, query = INSERTED_WIKILINK_QUERY) {
  const editor = page.locator('.bn-editor')
  await expect(editor).toBeVisible({ timeout: 5000 })

  const firstParagraph = editor.locator('p').first()
  await expect(
    firstParagraph,
  ).toContainText('Build a sustainable audience through high-quality weekly essays', { timeout: 5000 })
  const firstParagraphBox = await firstParagraph.boundingBox()
  if (!firstParagraphBox) throw new Error('Source paragraph is not visible')

  await page.mouse.click(
    firstParagraphBox.x + Math.max(1, firstParagraphBox.width - 2),
    firstParagraphBox.y + Math.max(1, firstParagraphBox.height - 2),
  )
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)

  await page.keyboard.type(query)

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

function writeMarkdownLinkJumpNote(vaultPath: string) {
  const filler = Array.from(
    { length: 80 },
    (_, index) => `Paragraph ${index + 1} keeps the anchor target below the initial viewport.`,
  ).join('\n\n')

  fs.writeFileSync(path.join(vaultPath, 'project', 'markdown-link-jump.md'), `---
Is A: Note
Status: Active
---

# ${MARKDOWN_LINK_NOTE_TITLE}

[Jump to target](#target-section)

[Open Note B](../note/note-b.md)

${filler}

## Target Section

Anchor target reached.
`, 'utf8')
}

async function openNote(page: Page, title: string) {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor h1').first()).toHaveText(title, { timeout: 5_000 })
}

async function dispatchModifiedLinkActivation(link: ReturnType<Page['locator']>): Promise<void> {
  await link.evaluate((element) => {
    const target = element.firstChild ?? element
    target.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    }))
    target.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
    }))
  })
}

test.describe('Wikilink insertion and navigation', () => {
  test.describe.configure({ timeout: 60_000 })

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    const noteItem = page.locator('.app__note-list .cursor-pointer').filter({ hasText: SOURCE_NOTE_TITLE }).first()
    await expect(noteItem).toBeVisible({ timeout: 10_000 })
    await noteItem.click()
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

  test('@smoke at-sign autocomplete inserts the same wikilink inline content as [[', async ({ page }) => {
    const wikilink = await insertWikilink(page, '@Mana')

    await expect(wikilink).toBeVisible()
    await expect(wikilink).not.toHaveClass(/wikilink--broken/u)
    await expect(wikilink).toHaveAttribute('data-target', INSERTED_WIKILINK_TARGET)
  })

  test('@smoke Cmd+clicking an inserted wikilink navigates to the note', async ({ page }) => {
    const wikilink = await insertWikilink(page)
    await expect(wikilink).toBeVisible()

    await wikilink.click({ modifiers: ['Meta'] })
    await expect(page.locator('.bn-editor h1').first()).toHaveText(INSERTED_WIKILINK_TITLE, { timeout: 5000 })
  })
})

test.describe('Standard markdown link navigation', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    tempVaultDir = createFixtureVaultCopy()
    writeMarkdownLinkJumpNote(tempVaultDir)
    await openFixtureVault(page, tempVaultDir, { expectedReadyTitle: MARKDOWN_LINK_NOTE_TITLE })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
    tempVaultDir = null
  })

  test('@smoke Cmd+clicking standard markdown links jumps within and across notes', async ({ page }) => {
    await openNote(page, MARKDOWN_LINK_NOTE_TITLE)

    const scrollArea = page.locator('.editor-scroll-area').first()
    const targetHeading = page.locator('.bn-editor [data-content-type="heading"]').filter({ hasText: 'Target Section' }).first()
    const beforeScrollTop = await scrollArea.evaluate(element => element.scrollTop)
    await dispatchModifiedLinkActivation(page.locator('.bn-editor a').filter({ hasText: 'Jump to target' }).first())

    await expect.poll(() => scrollArea.evaluate(element => element.scrollTop)).toBeGreaterThan(beforeScrollTop)
    await expect(targetHeading).toBeInViewport()

    await dispatchModifiedLinkActivation(page.locator('.bn-editor a').filter({ hasText: 'Open Note B' }).first())
    await expect(page.locator('.bn-editor h1').first()).toHaveText('Note B', { timeout: 5_000 })
  })
})
