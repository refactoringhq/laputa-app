import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

const NOTE_TITLE = 'List Tab Focus'
const NOTE_PATH = path.join('note', 'list-tab-focus.md')

function writeListFixture(vaultPath: string): void {
  fs.writeFileSync(path.join(vaultPath, NOTE_PATH), `---
Is A: Note
Status: Active
---

# ${NOTE_TITLE}

- Parent
- Child
`)
}

function activeBlockContext(): { focused: boolean; text: string; type: string } | null {
  const selection = document.getSelection()
  const node = selection?.anchorNode
  const element = node instanceof Element ? node : node?.parentElement
  const content = element?.closest<HTMLElement>('[data-content-type]')
  if (!content?.dataset.contentType) return null

  return {
    focused: document.querySelector('.bn-editor')?.contains(document.activeElement) === true,
    text: content.textContent ?? '',
    type: content.dataset.contentType,
  }
}

async function childIndent(page: Page): Promise<number> {
  const child = page.locator('[data-content-type="bulletListItem"]', { hasText: 'Child' }).first()
  return child.evaluate(element => element.getBoundingClientRect().left)
}

let tempVaultDir: string

test.beforeEach(async ({ page }) => {
  tempVaultDir = createFixtureVaultCopy()
  writeListFixture(tempVaultDir)
  await openFixtureVault(page, tempVaultDir)
  await page.getByText(NOTE_TITLE, { exact: true }).first().click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 10_000 })
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('keeps repeated list Tab and outdent actions inside the editor', async ({ page }) => {
  const child = page.locator('[data-content-type="bulletListItem"]', { hasText: 'Child' }).first()
  const initialIndent = await childIndent(page)
  await child.click()

  await page.keyboard.press('Tab')
  await expect.poll(() => childIndent(page)).toBeGreaterThan(initialIndent)
  await expect.poll(() => page.evaluate(activeBlockContext)).toEqual({
    focused: true,
    text: 'Child',
    type: 'bulletListItem',
  })

  await page.keyboard.press('Tab')
  await expect.poll(() => page.evaluate(activeBlockContext)).toEqual({
    focused: true,
    text: 'Child',
    type: 'bulletListItem',
  })

  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => childIndent(page)).toBe(initialIndent)
  await expect.poll(() => page.evaluate(activeBlockContext)).toEqual({
    focused: true,
    text: 'Child',
    type: 'bulletListItem',
  })
})
