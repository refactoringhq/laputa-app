import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

const NESTED_TASK_ORDERED_LIST_NOTE = `---
title: Note B
type: Note
status: Active
---

# Note B

- [ ] 123
  1. composition target
`

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  void page
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
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
  await openFixtureVault(page, tempVaultDir)
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

    editor?.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    const paragraphInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertParagraph',
    })
    element.dispatchEvent(paragraphInput)

    return {
      defaultPrevented: event.defaultPrevented,
      paragraphDefaultPrevented: paragraphInput.defaultPrevented,
      reachedEditorBubble,
    }
  })

  expect(dispatchResult).toEqual({
    defaultPrevented: false,
    paragraphDefaultPrevented: true,
    reachedEditorBubble: false,
  })
  await expect(page.locator('.bn-block-content[data-content-type="bulletListItem"]')).toHaveCount(
    bulletCountBefore,
  )

  await page.keyboard.type(' 계속')
  await expect(bullet).toContainText('한글 시작 계속')
})

test('composing Space inside a task-list nested ordered item stays inside IME handling', async ({ page }) => {
  fs.writeFileSync(path.join(tempVaultDir, 'note', 'note-b.md'), NESTED_TASK_ORDERED_LIST_NOTE)
  await openFixtureVault(page, tempVaultDir)
  await openNote(page, 'Note B')

  const orderedItem = page.locator('.bn-block-content[data-content-type="numberedListItem"]', {
    hasText: 'composition target',
  }).first()
  await expect(orderedItem).toBeVisible({ timeout: 5_000 })
  await orderedItem.click()

  const orderedItemCountBefore = await page
    .locator('.bn-block-content[data-content-type="numberedListItem"]')
    .count()
  const dispatchResult = await orderedItem.evaluate((element) => {
    const editor = document.querySelector('.bn-editor')
    let reachedEditorBubble = false
    const handleKeydown = () => {
      reachedEditorBubble = true
    }

    editor?.addEventListener('keydown', handleKeydown, { once: true })
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
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
  await expect(page.locator('.bn-block-content[data-content-type="numberedListItem"]')).toHaveCount(
    orderedItemCountBefore,
  )

  await page.keyboard.insertText(' 继续')
  await expect(orderedItem).toContainText('composition target 继续')
})
