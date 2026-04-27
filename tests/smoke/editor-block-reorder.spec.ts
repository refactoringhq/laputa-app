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

async function visibleDragHandle(page: Page, block: Locator): Promise<Locator> {
  await block.hover()
  const handle = page.locator('.bn-side-menu [draggable="true"]').first()
  await expect(handle).toBeVisible({ timeout: 5_000 })
  return handle
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
  await page.mouse.up()
}

test('dragging the left block handle reorders editor blocks', async ({ page }) => {
  await page.getByText('Alpha Project', { exact: true }).first().click()
  const editor = page.locator('.bn-editor')
  await expect(editor).toBeVisible({ timeout: 5_000 })

  const paragraph = await blockOuterForText(page, 'This is a test project that references other notes.')
  const notesHeading = await blockOuterForText(page, 'Notes')

  await expect.poll(async () => editor.textContent()).toMatch(/Alpha Project[\s\S]*This is a test project[\s\S]*Notes/)

  const handle = await visibleDragHandle(page, notesHeading)
  await dragHandleToBlock(page, handle, paragraph)

  await expect.poll(async () => editor.textContent()).toMatch(/Alpha Project[\s\S]*Notes[\s\S]*This is a test project/)
})
