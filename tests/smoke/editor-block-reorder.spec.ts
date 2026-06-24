import fs from 'fs'
import path from 'path'
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

  const sectionControl = page.locator('.bn-side-menu button:has([data-test="headingCollapseToggle"])').first()
  const handle = page.locator('.bn-side-menu button:has([data-test="dragHandle"])').first()
  await expect(sectionControl).toBeVisible({ timeout: 5_000 })
  await expect(handle).toBeVisible({ timeout: 5_000 })
  await expect(handle).not.toHaveAttribute('draggable', 'true')

  const controlBox = await sectionControl.boundingBox()
  const handleBox = await handle.boundingBox()
  expect(controlBox).not.toBeNull()
  expect(handleBox).not.toBeNull()
  expect(handleBox!.x).toBeLessThan(controlBox!.x)
  expect(Math.abs((controlBox!.y + controlBox!.height / 2) - (handleBox!.y + handleBox!.height / 2))).toBeLessThanOrEqual(2)

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

async function collapsedHeadingEllipsisPoint(heading: Locator): Promise<{ x: number; y: number }> {
  const point = await heading.evaluate((headingElement) => {
    const inlineHeading = headingElement.querySelector('.bn-inline-content')
    if (!(inlineHeading instanceof HTMLElement)) return null

    const range = document.createRange()
    range.selectNodeContents(inlineHeading)
    const textRect = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .at(-1)
    range.detach()
    if (!textRect) return null

    const parseLength = (value: string) => {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    const afterStyle = window.getComputedStyle(inlineHeading, '::after')
    const marginStart = parseLength(afterStyle.getPropertyValue('margin-inline-start'))
    const dotsWidth = Math.max(
      parseLength(afterStyle.width),
      parseLength(afterStyle.minWidth),
    ) + parseLength(afterStyle.paddingLeft) + parseLength(afterStyle.paddingRight)
    const isRtl = window.getComputedStyle(inlineHeading).direction === 'rtl'

    return {
      x: isRtl
        ? textRect.left - marginStart - dotsWidth / 2
        : textRect.right + marginStart + dotsWidth / 2,
      y: textRect.top + textRect.height / 2,
    }
  })

  expect(point).not.toBeNull()
  return point!
}

async function clickCollapsedHeadingEllipsis(page: Page, heading: Locator): Promise<void> {
  const point = await collapsedHeadingEllipsisPoint(heading)
  await page.mouse.click(point.x, point.y)
}

function writeAlphaProjectContent(content: string): void {
  fs.writeFileSync(path.join(tempVaultDir, 'project', 'alpha-project.md'), content, 'utf8')
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

test('heading caret collapses the following section blocks and ellipsis expands them', async ({ page }) => {
  await page.getByText('Alpha Project', { exact: true }).first().click()
  const editor = page.locator('.bn-editor')
  await expect(editor).toBeVisible({ timeout: 5_000 })

  const notesHeading = await blockOuterForText(page, 'Notes')
  const detailsBlock = editor.locator('.bn-block-outer').filter({ hasText: 'See' }).first()
  await expect(detailsBlock).toBeVisible()

  await notesHeading.hover()
  const collapseButton = page.locator('.bn-side-menu button:has([data-test="headingCollapseToggle"])').first()
  await expect(collapseButton).toBeVisible({ timeout: 5_000 })
  await collapseButton.click()

  await expect(detailsBlock).toBeHidden()

  const dotsContent = await notesHeading.evaluate((heading) => {
    const inlineHeading = heading.querySelector('.bn-inline-content')
    if (!inlineHeading) return ''
    return window.getComputedStyle(inlineHeading, '::after').content
  })
  expect(dotsContent).toBe('"..."')

  const baseDotsBackground = await notesHeading.evaluate((heading) => {
    const inlineHeading = heading.querySelector('.bn-inline-content')
    if (!inlineHeading) return ''
    return window.getComputedStyle(inlineHeading, '::after').backgroundColor
  })
  const ellipsisPoint = await collapsedHeadingEllipsisPoint(notesHeading)
  await page.mouse.move(ellipsisPoint.x, ellipsisPoint.y)
  await expect.poll(async () => notesHeading.evaluate((heading) => {
    const inlineHeading = heading.querySelector('.bn-inline-content')
    if (!inlineHeading) return ''
    return window.getComputedStyle(inlineHeading).cursor
  })).toBe('pointer')
  const hoverDotsBackground = await notesHeading.evaluate((heading) => {
    const inlineHeading = heading.querySelector('.bn-inline-content')
    if (!inlineHeading) return ''
    return window.getComputedStyle(inlineHeading, '::after').backgroundColor
  })
  expect(hoverDotsBackground).not.toBe(baseDotsBackground)

  await clickCollapsedHeadingEllipsis(page, notesHeading)
  await expect(detailsBlock).toBeVisible()
})

test('list item caret collapses child list items and ellipsis expands them', async ({ page }) => {
  writeAlphaProjectContent(`---
Is A: Project
Status: Active
Owner: "Test User"
---

# Alpha Project

## Nested List

- Parent item
  - Child item
    - Grandchild item
  - Second child item
- Sibling item
`)

  await page.getByText('Alpha Project', { exact: true }).first().click()
  const editor = page.locator('.bn-editor')
  await expect(editor).toBeVisible({ timeout: 5_000 })

  const parentItem = await blockOuterForText(page, 'Parent item')
  const childItem = await blockOuterForText(page, 'Child item')
  const grandchildItem = await blockOuterForText(page, 'Grandchild item')
  const secondChildItem = await blockOuterForText(page, 'Second child item')
  const siblingItem = await blockOuterForText(page, 'Sibling item')

  await editor.getByText('Parent item', { exact: true }).hover()
  const collapseButton = page.locator('.bn-side-menu button:has([data-test="headingCollapseToggle"])').first()
  await expect(collapseButton).toBeVisible({ timeout: 5_000 })
  await collapseButton.click()

  await expect(childItem).toBeHidden()
  await expect(grandchildItem).toBeHidden()
  await expect(secondChildItem).toBeHidden()
  await expect(siblingItem).toBeVisible()

  const dotsContent = await parentItem.evaluate((item) => {
    const inlineContent = item.querySelector('.bn-inline-content')
    if (!inlineContent) return ''
    return window.getComputedStyle(inlineContent, '::after').content
  })
  expect(dotsContent).toBe('"..."')

  await clickCollapsedHeadingEllipsis(page, parentItem)
  await expect(childItem).toBeVisible()
  await expect(grandchildItem).toBeVisible()
  await expect(secondChildItem).toBeVisible()
  await expect(siblingItem).toBeVisible()
})
