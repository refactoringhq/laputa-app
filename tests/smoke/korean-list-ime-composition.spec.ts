import { test, expect, type Locator, type Page } from '@playwright/test'
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

async function createListItem(page: Page, slashCommand: string, optionName: RegExp, contentType: string) {
  await page.locator('.bn-block-content').nth(1).click()
  await page.keyboard.type(slashCommand)
  await expect(page.getByRole('option', { name: optionName })).toBeVisible()
  await page.keyboard.press('Enter')

  const item = page.locator(`.bn-block-content[data-content-type="${contentType}"]`).last()
  await expect(item).toBeVisible()
  return item
}

async function createBulletListItem(page: Page) {
  return createListItem(page, '/bul', /Bullet List/i, 'bulletListItem')
}

async function createNumberedListItem(page: Page) {
  return createListItem(page, '/num', /Numbered List/i, 'numberedListItem')
}

async function createNestedBulletListItem(page: Page) {
  const parent = await createBulletListItem(page)
  await page.keyboard.type('부모 항목')
  await expect(parent).toContainText('부모 항목')
  await page.keyboard.press('Enter')
  await page.keyboard.type('하위 항목')
  await page.keyboard.press('Tab')

  const child = page.locator('.bn-block-content[data-content-type="bulletListItem"]').last()
  await expect(child).toContainText('하위 항목')
  await expect(page.locator('.bn-block-content[data-content-type="bulletListItem"]')).toContainText([
    '부모 항목',
    '하위 항목',
  ])
  return child
}

async function createNestedNumberedListItem(page: Page) {
  const parent = await createNumberedListItem(page)
  await page.keyboard.type('부모 항목')
  await expect(parent).toContainText('부모 항목')
  await page.keyboard.press('Enter')
  await page.keyboard.type('하위 항목')
  await page.keyboard.press('Tab')

  const child = page.locator('.bn-block-content[data-content-type="numberedListItem"]').last()
  await expect(child).toContainText('하위 항목')
  await expect(page.locator('.bn-block-content[data-content-type="numberedListItem"]')).toContainText([
    '부모 항목',
    '하위 항목',
  ])
  return child
}

async function getBlockNestingDepth(blockContent: Locator) {
  return blockContent.evaluate((element) => {
    const ownOuter = element.closest('[data-node-type="blockOuter"]')
    if (!ownOuter) return -1

    let depth = 0
    let group = ownOuter.parentElement

    while (group?.matches('[data-node-type="blockGroup"]')) {
      const containingBlock = group.parentElement
      if (!containingBlock?.matches('[data-node-type="blockContainer"]')) break

      depth += 1
      group = containingBlock.closest('[data-node-type="blockGroup"]')
    }

    return depth
  })
}

async function dispatchComposingKey(page: Page, selector: string, key: string, code = key) {
  return page.locator(selector).last().evaluate((element, eventInit) => {
    const editor = document.querySelector('.bn-editor')
    let reachedEditorBubble = false
    const handleKeydown = () => {
      reachedEditorBubble = true
    }

    editor?.addEventListener('keydown', handleKeydown, { once: true })
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: eventInit.code,
      key: eventInit.key,
    })
    Object.defineProperty(event, 'isComposing', { value: true })
    element.dispatchEvent(event)
    editor?.removeEventListener('keydown', handleKeydown)

    return {
      defaultPrevented: event.defaultPrevented,
      reachedEditorBubble,
    }
  }, { code, key })
}

async function dispatchPostCompositionStructuralInput(
  target: Locator,
  inputType: 'insertParagraph' | 'insertLineBreak' = 'insertParagraph',
) {
  return target.evaluate((element, eventInit) => {
    const editor = document.querySelector('.bn-editor')
    let reachedEditorKeydownBubble = false
    let reachedEditorBeforeInputBubble = false
    const handleKeydown = () => {
      reachedEditorKeydownBubble = true
    }
    const handleBeforeInput = () => {
      reachedEditorBeforeInputBubble = true
    }

    editor?.addEventListener('keydown', handleKeydown, { once: true })
    editor?.addEventListener('beforeinput', handleBeforeInput, { once: true })
    element.dispatchEvent(new CompositionEvent('compositionstart', {
      bubbles: true,
      cancelable: true,
      data: "ce'shi",
    }))
    element.dispatchEvent(new CompositionEvent('compositionupdate', {
      bubbles: true,
      cancelable: true,
      data: "ce'shi",
    }))
    element.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      cancelable: true,
      data: '测试',
    }))

    const keydown = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Enter',
      key: 'Enter',
    })
    element.dispatchEvent(keydown)

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: null,
      inputType: eventInit.inputType,
    })
    element.dispatchEvent(beforeInput)
    editor?.removeEventListener('keydown', handleKeydown)
    editor?.removeEventListener('beforeinput', handleBeforeInput)

    return {
      beforeInputDefaultPrevented: beforeInput.defaultPrevented,
      keydownDefaultPrevented: keydown.defaultPrevented,
      reachedEditorBeforeInputBubble,
      reachedEditorKeydownBubble,
    }
  }, { inputType })
}

test('@smoke composing Enter inside a Korean bullet item does not split the list item', async ({ page }) => {
  await openNote(page, 'Note B')
  const bullet = await createBulletListItem(page)
  await page.keyboard.type('한글 시작')
  await expect(bullet).toContainText('한글 시작')

  const bulletCountBefore = await page.locator('.bn-block-content[data-content-type="bulletListItem"]').count()
  const dispatchResult = await dispatchComposingKey(
    page,
    '.bn-block-content[data-content-type="bulletListItem"]',
    'Enter',
  )

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

test('@smoke composing Tab inside a nested Korean bullet item does not indent the list item', async ({ page }) => {
  await openNote(page, 'Note B')
  const child = await createNestedBulletListItem(page)
  const bulletItems = page.locator('.bn-block-content[data-content-type="bulletListItem"]')
  const bulletCountBefore = await bulletItems.count()
  const childDepthBefore = await getBlockNestingDepth(child)

  const dispatchResult = await dispatchComposingKey(
    page,
    '.bn-block-content[data-content-type="bulletListItem"]',
    'Tab',
  )

  expect(dispatchResult).toEqual({
    defaultPrevented: false,
    reachedEditorBubble: false,
  })
  await expect(bulletItems).toHaveCount(bulletCountBefore)
  await expect(child).toContainText('하위 항목')
  await expect.poll(() => getBlockNestingDepth(child)).toBe(childDepthBefore)

  await page.keyboard.type(' 계속')
  await expect(child).toContainText('하위 항목 계속')
})

test('@smoke post-composition Enter inside a Korean bullet item does not split the list item', async ({ page }) => {
  await openNote(page, 'Note B')
  const bullet = await createBulletListItem(page)
  await page.keyboard.type('한글 시작')
  await expect(bullet).toContainText('한글 시작')

  const bulletItems = page.locator('.bn-block-content[data-content-type="bulletListItem"]')
  const bulletCountBefore = await bulletItems.count()
  const dispatchResult = await dispatchPostCompositionStructuralInput(bullet)

  expect(dispatchResult).toEqual({
    beforeInputDefaultPrevented: true,
    keydownDefaultPrevented: true,
    reachedEditorBeforeInputBubble: false,
    reachedEditorKeydownBubble: false,
  })
  await expect(bulletItems).toHaveCount(bulletCountBefore)

  await page.keyboard.type(' 계속')
  await expect(bullet).toContainText('한글 시작 계속')
})

test('@smoke post-composition Enter inside a Korean numbered item does not split the list item', async ({ page }) => {
  await openNote(page, 'Note B')
  const item = await createNumberedListItem(page)
  await page.keyboard.type('한글 시작')
  await expect(item).toContainText('한글 시작')

  const numberedItems = page.locator('.bn-block-content[data-content-type="numberedListItem"]')
  const numberedCountBefore = await numberedItems.count()
  const dispatchResult = await dispatchPostCompositionStructuralInput(item)

  expect(dispatchResult).toEqual({
    beforeInputDefaultPrevented: true,
    keydownDefaultPrevented: true,
    reachedEditorBeforeInputBubble: false,
    reachedEditorKeydownBubble: false,
  })
  await expect(numberedItems).toHaveCount(numberedCountBefore)

  await page.keyboard.type(' 계속')
  await expect(item).toContainText('한글 시작 계속')
})

test('@smoke post-composition Enter inside a nested Korean bullet item does not split the list item', async ({ page }) => {
  await openNote(page, 'Note B')
  const child = await createNestedBulletListItem(page)
  const bulletItems = page.locator('.bn-block-content[data-content-type="bulletListItem"]')
  const bulletCountBefore = await bulletItems.count()
  const childDepthBefore = await getBlockNestingDepth(child)

  const dispatchResult = await dispatchPostCompositionStructuralInput(child)

  expect(dispatchResult).toEqual({
    beforeInputDefaultPrevented: true,
    keydownDefaultPrevented: true,
    reachedEditorBeforeInputBubble: false,
    reachedEditorKeydownBubble: false,
  })
  await expect(bulletItems).toHaveCount(bulletCountBefore)
  await expect.poll(() => getBlockNestingDepth(child)).toBe(childDepthBefore)

  await page.keyboard.type(' 계속')
  await expect(child).toContainText('하위 항목 계속')
})

test('@smoke post-composition Enter inside a nested Korean numbered item does not split the list item', async ({ page }) => {
  await openNote(page, 'Note B')
  const child = await createNestedNumberedListItem(page)
  const numberedItems = page.locator('.bn-block-content[data-content-type="numberedListItem"]')
  const numberedCountBefore = await numberedItems.count()
  const childDepthBefore = await getBlockNestingDepth(child)

  const dispatchResult = await dispatchPostCompositionStructuralInput(child)

  expect(dispatchResult).toEqual({
    beforeInputDefaultPrevented: true,
    keydownDefaultPrevented: true,
    reachedEditorBeforeInputBubble: false,
    reachedEditorKeydownBubble: false,
  })
  await expect(numberedItems).toHaveCount(numberedCountBefore)
  await expect.poll(() => getBlockNestingDepth(child)).toBe(childDepthBefore)

  await page.keyboard.type(' 계속')
  await expect(child).toContainText('하위 항목 계속')
})
