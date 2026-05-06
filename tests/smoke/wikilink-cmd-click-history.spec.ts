import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

let tempVaultDir: string

async function openNote(page: Page, title: string) {
  const noteList = page.locator('[data-testid="note-list-container"]')
  await noteList.getByText(title, { exact: true }).click()
}

async function expectActiveHeading(page: Page, title: string) {
  await expect(page.locator('.bn-editor h1').first()).toHaveText(title, { timeout: 5_000 })
}

function trackStaleWikilinkClickErrors(page: Page): string[] {
  const messages: string[] = []
  page.on('pageerror', (error) => {
    if (error.message.includes('dispatchEvent')) messages.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('dispatchEvent')) {
      messages.push(message.text())
    }
  })
  return messages
}

async function appendToProjectParagraph(page: Page, marker: string): Promise<void> {
  const paragraph = page.locator('.bn-editor p')
    .filter({ hasText: 'This is a test project that references other notes.' })
    .first()
  await expect(paragraph).toBeVisible({ timeout: 5_000 })

  const box = await paragraph.boundingBox()
  if (!box) throw new Error('Expected editable paragraph bounds')
  await paragraph.click({
    position: {
      x: Math.max(1, box.width - 2),
      y: Math.max(1, box.height / 2),
    },
  })
  await page.keyboard.press('End')
  await page.keyboard.type(` ${marker}`)
}

async function expectFileToContain(filePath: string, marker: string): Promise<void> {
  await expect.poll(() => fs.readFileSync(filePath, 'utf8'), { timeout: 10_000 }).toContain(marker)
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke Cmd-clicking an existing wikilink preserves Back/Forward history', async ({ page }) => {
  await openNote(page, 'Alpha Project')
  await expectActiveHeading(page, 'Alpha Project')

  const wikilink = page.locator('.bn-editor .wikilink').filter({ hasText: 'Note B' }).first()
  await expect(wikilink).toBeVisible()

  await wikilink.click({ modifiers: ['Meta'] })
  await expectActiveHeading(page, 'Note B')

  await page.keyboard.press('Meta+ArrowLeft')
  await expectActiveHeading(page, 'Alpha Project')

  await page.keyboard.press('Meta+ArrowRight')
  await expectActiveHeading(page, 'Note B')

  await openNote(page, 'Note C')
  await expectActiveHeading(page, 'Note C')

  await page.keyboard.press('Meta+ArrowLeft')
  await expectActiveHeading(page, 'Note B')
})

test('Cmd-clicking a wikilink after rich-edit autosave does not dispatch through stale link nodes', async ({ page }) => {
  const staleClickErrors = trackStaleWikilinkClickErrors(page)
  const marker = `autosaved wikilink click ${Date.now()}`
  const alphaPath = path.join(tempVaultDir, 'project', 'alpha-project.md')

  await openNote(page, 'Alpha Project')
  await expectActiveHeading(page, 'Alpha Project')

  await appendToProjectParagraph(page, marker)
  await expectFileToContain(alphaPath, marker)

  const wikilink = page.locator('.bn-editor .wikilink').filter({ hasText: 'Note B' }).first()
  await expect(wikilink).toBeVisible()

  await wikilink.click()
  await expectActiveHeading(page, 'Alpha Project')
  expect(staleClickErrors).toEqual([])

  await wikilink.click({ modifiers: ['Meta'] })
  await expectActiveHeading(page, 'Note B')
  expect(staleClickErrors).toEqual([])
})
