import { test, expect, type Locator, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function blockOuterForText(page: Page, text: string): Promise<Locator> {
  const textNode = page.locator('.bn-editor').getByText(text, { exact: true }).first()
  await expect(textNode).toBeVisible({ timeout: 5_000 })
  return textNode.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " bn-block-outer ")][1]')
}

async function visibleLeftBlockHandle(page: Page, block: Locator): Promise<Locator> {
  await block.hover()

  const addButton = page.locator('.bn-side-menu button:has([data-test="dragHandleAdd"])').first()
  const handle = page.locator('.bn-side-menu button:has([data-test="dragHandle"])').first()
  await expect(addButton).toBeVisible({ timeout: 5_000 })
  await expect(handle).toBeVisible({ timeout: 5_000 })
  await expect(handle).not.toHaveAttribute('draggable', 'true')

  const addBox = await addButton.boundingBox()
  const handleBox = await handle.boundingBox()
  expect(addBox).not.toBeNull()
  expect(handleBox).not.toBeNull()
  expect(addBox!.x).toBeLessThan(handleBox!.x)
  expect(Math.abs((addBox!.y + addBox!.height / 2) - (handleBox!.y + handleBox!.height / 2))).toBeLessThanOrEqual(2)

  return handle
}

async function expectSideMenuCenteredOnText(page: Page, text: string): Promise<void> {
  const block = await blockOuterForText(page, text)
  await block.hover()
  await expect(page.locator('.bn-side-menu')).toBeVisible({ timeout: 5_000 })

  const delta = await block.evaluate((blockElement) => {
    const content = blockElement.querySelector('.bn-block-content')
    const inlineContent = content?.querySelector('.bn-inline-content') ?? content
    const sideMenu = document.querySelector('.bn-side-menu')
    if (!inlineContent || !sideMenu) return Number.POSITIVE_INFINITY

    const range = document.createRange()
    range.selectNodeContents(inlineContent)
    const textRect = Array.from(range.getClientRects())
      .find((rect) => rect.width > 0 && rect.height > 0) ?? range.getBoundingClientRect()
    range.detach()

    const sideMenuRect = sideMenu.getBoundingClientRect()
    return Math.abs(
      (sideMenuRect.top + sideMenuRect.height / 2) -
      (textRect.top + textRect.height / 2),
    )
  })

  expect(delta).toBeLessThanOrEqual(2)
}

async function expectSideMenuCenteredOnFirstTextLine(page: Page, text: string): Promise<void> {
  const block = await blockOuterForText(page, text)
  await block.hover()
  await expect(page.locator('.bn-side-menu')).toBeVisible({ timeout: 5_000 })

  const metrics = await block.evaluate((blockElement) => {
    const content = blockElement.querySelector('.bn-block-content')
    const inlineContent = content?.querySelector('.bn-inline-content') ?? content
    const sideMenu = document.querySelector('.bn-side-menu')
    if (!inlineContent || !sideMenu) return null

    const range = document.createRange()
    range.selectNodeContents(inlineContent)
    const lineRects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
    const textRect = range.getBoundingClientRect()
    range.detach()
    if (lineRects.length < 2 || textRect.height <= lineRects[0].height) return null

    const firstLineCenter = lineRects[0].top + lineRects[0].height / 2
    const fullTextCenter = textRect.top + textRect.height / 2
    const sideMenuRect = sideMenu.getBoundingClientRect()
    const sideMenuCenter = sideMenuRect.top + sideMenuRect.height / 2

    return {
      firstLineDelta: Math.abs(sideMenuCenter - firstLineCenter),
      fullTextDelta: Math.abs(sideMenuCenter - fullTextCenter),
    }
  })

  expect(metrics).not.toBeNull()
  expect(metrics!.firstLineDelta).toBeLessThanOrEqual(2)
  expect(metrics!.fullTextDelta).toBeGreaterThan(8)
}

async function dragHandleToBlock(page: Page, handle: Locator, targetBlock: Locator): Promise<void> {
  const handleBox = await handle.boundingBox()
  const targetBox = await targetBlock.boundingBox()

  expect(handleBox).not.toBeNull()
  expect(targetBox).not.toBeNull()

  const start = {
    x: handleBox!.x + handleBox!.width / 2,
    y: handleBox!.y + handleBox!.height / 2,
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 4, start.y + 4, { steps: 4 })
  await page.mouse.move(start.x + 16, start.y + 16, { steps: 8 })
  await page.mouse.move(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + 2,
    { steps: 24 },
  )

  const dragPreview = page.getByTestId('editor-block-drag-preview')
  const dropIndicator = page.getByTestId('editor-block-drop-indicator')
  await expect(dragPreview).toBeVisible()
  await expect(dragPreview).toHaveCSS('opacity', '0.72')
  await expect(dropIndicator).toBeVisible()

  await page.mouse.up()
  await expect(dragPreview).toHaveCount(0)
  await expect(dropIndicator).toHaveCount(0)
}

test('dragging the left block handle reorders editor blocks', async ({ page }) => {
  await page.getByText('Alpha Project', { exact: true }).first().click()
  const editor = page.locator('.bn-editor')
  await expect(editor).toBeVisible({ timeout: 5_000 })

  const paragraph = await blockOuterForText(page, 'This is a test project that references other notes.')
  const notesHeading = await blockOuterForText(page, 'Notes')

  await expect.poll(async () => editor.textContent()).toMatch(/Alpha Project[\s\S]*This is a test project[\s\S]*Notes/)
  await expectSideMenuCenteredOnText(page, 'Alpha Project')
  await expectSideMenuCenteredOnText(page, 'Notes')

  const handle = await visibleLeftBlockHandle(page, notesHeading)
  await dragHandleToBlock(page, handle, paragraph)

  await expect.poll(async () => editor.textContent()).toMatch(/Alpha Project[\s\S]*Notes[\s\S]*This is a test project/)
})

test('left block handle aligns with the first line of wrapped text', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 })
  await page.getByText('Alpha Project', { exact: true }).first().click()
  const editor = page.locator('.bn-editor')
  await expect(editor).toBeVisible({ timeout: 5_000 })

  await page.addStyleTag({
    content: '.bn-editor { max-width: 320px !important; }',
  })

  await expectSideMenuCenteredOnFirstTextLine(
    page,
    'This is a test project that references other notes.',
  )
})
