import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultTauri, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

async function createUntitledNote(page: Page): Promise<void> {
  await page.locator('body').click()
  await triggerMenuCommand(page, 'file-new-note')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+(?:-\d+)?/i, {
    timeout: 5_000,
  })
}

async function clearEditorSelection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    active?.blur()
    window.getSelection()?.removeAllRanges()
  })
}

async function clickTitleWrapperPadding(page: Page): Promise<void> {
  const clickTarget = await page.evaluate(() => {
    const titleBlockOuter = document.querySelector('.bn-block-outer') as HTMLElement | null
    if (!titleBlockOuter) return null

    const rect = titleBlockOuter.getBoundingClientRect()
    return {
      x: rect.left + Math.min(32, Math.max(12, rect.width / 2)),
      y: rect.bottom - Math.min(4, Math.max(1, rect.height / 3)),
    }
  })

  expect(clickTarget).not.toBeNull()
  await page.mouse.click(clickTarget!.x, clickTarget!.y)
}

async function activeSelectionBlockType(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const selection = window.getSelection()
    const anchorNode = selection?.anchorNode ?? null
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null
    return anchorElement?.closest('.bn-block-content')?.getAttribute('data-content-type') ?? null
  })
}

async function editorHasContentEditableFocus(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return Boolean(active?.isContentEditable || active?.closest('[contenteditable="true"]'))
  })
}

async function dropCaretBeforeNextClick(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.addEventListener('click', () => {
      const active = document.activeElement as HTMLElement | null
      active?.blur()
      window.getSelection()?.removeAllRanges()
    }, { capture: true, once: true })
  })
}

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultTauri(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke clicking an untitled title wrapper restores the caret to the H1', async ({ page }) => {
  await createUntitledNote(page)
  await clearEditorSelection(page)

  await expect.poll(() => editorHasContentEditableFocus(page), { timeout: 5_000 }).toBe(false)

  await clickTitleWrapperPadding(page)

  await expect.poll(() => editorHasContentEditableFocus(page), { timeout: 5_000 }).toBe(true)
  await expect.poll(() => activeSelectionBlockType(page), { timeout: 5_000 }).toBe('heading')
})

test('@smoke clicking editable text restores a dropped dark-mode caret after Enter', async ({ page }) => {
  await createUntitledNote(page)
  const title = page.locator('.bn-block-content[data-content-type="heading"]').first()
  await title.click()
  await page.keyboard.type('Focus recovery')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Body before recovery')

  const root = page.locator('html')
  if (await root.getAttribute('data-theme') !== 'dark') {
    await page.getByTestId('status-theme-mode').click()
  }
  await expect(root).toHaveAttribute('data-theme', 'dark')

  const body = page.locator('.bn-block-content[data-content-type="paragraph"]')
    .filter({ hasText: 'Body before recovery' })
    .first()
  await dropCaretBeforeNextClick(page)
  await body.click()

  await expect.poll(() => editorHasContentEditableFocus(page), { timeout: 5_000 }).toBe(true)
  await expect.poll(() => activeSelectionBlockType(page), { timeout: 5_000 }).toBe('paragraph')
  await page.keyboard.type(' restored')
  await expect(body).toContainText('restored')
})
