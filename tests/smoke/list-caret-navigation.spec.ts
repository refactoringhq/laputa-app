import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

const NOTE_TITLE = 'List Caret Boundary'
const NOTE_PATH = path.join('note', 'list-caret-boundary.md')

function writeListCaretFixture(vaultPath: string): void {
  fs.writeFileSync(path.join(vaultPath, NOTE_PATH), `---
Is A: Note
Status: Active
---

# ${NOTE_TITLE}

- Previous item
- List
-

After list
`)
}

function activeBlockContext(): { text: string; type: string } | null {
  const selection = document.getSelection()
  const node = selection?.anchorNode
  const element = node instanceof Element ? node : node?.parentElement
  const content = element?.closest<HTMLElement>('[data-content-type]')
  return content?.dataset.contentType
    ? { text: content.textContent ?? '', type: content.dataset.contentType }
    : null
}

async function openListNote(page: Page): Promise<void> {
  await openFixtureVault(page, tempVaultDir)
  const note = page.locator('[data-testid="note-list-container"]')
    .getByText(NOTE_TITLE, { exact: true })
  await expect(note).toBeVisible({ timeout: 10_000 })
  await note.click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 10_000 })
}

let tempVaultDir: string

test.beforeEach(() => {
  tempVaultDir = createFixtureVaultCopy()
  writeListCaretFixture(tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('keeps an empty final bullet reachable by mouse and vertical arrows', async ({ page }) => {
  await openListNote(page)

  const bullets = page.locator('[data-content-type="bulletListItem"]')
  await expect(bullets).toHaveCount(3)
  const populatedBullet = bullets.filter({ hasText: 'List' })
  const emptyBullet = bullets.nth(2)
  const trailingParagraph = page.locator('[data-content-type="paragraph"]').last()

  await page.evaluate(() => {
    document.getSelection()?.removeAllRanges()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  await emptyBullet.click()
  await expect.poll(() => page.evaluate(activeBlockContext)).toEqual({ text: '', type: 'bulletListItem' })

  await populatedBullet.click()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => page.evaluate(activeBlockContext)).toEqual({ text: '', type: 'bulletListItem' })

  await page.keyboard.press('ArrowDown')
  await expect.poll(() => page.evaluate(activeBlockContext)).toEqual({ text: 'After list', type: 'paragraph' })

  await trailingParagraph.click()
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => page.evaluate(activeBlockContext)).toEqual({ text: '', type: 'bulletListItem' })
})
