import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

const WHITEBOARD_NOTE = [
  '# Whiteboard Embed',
  '',
  'Context before the board.',
  '',
  '```tldraw id="planning-map"',
  '{}',
  '```',
  '',
  'Context after the board.',
  '',
].join('\n')

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  fs.writeFileSync(path.join(tempVaultDir, 'note', 'whiteboard-embed.md'), WHITEBOARD_NOTE)
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string): Promise<void> {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function toggleRawMode(page: Page, visibleSelector: '.bn-editor' | '.cm-content'): Promise<void> {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator(visibleSelector)).toBeVisible({ timeout: 5_000 })
}

async function getRawEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    type CodeMirrorHost = Element & {
      cmTile?: {
        view?: {
          state: {
            doc: {
              toString(): string
            }
          }
        }
      }
    }

    const host = document.querySelector('.cm-content') as CodeMirrorHost | null
    return host?.cmTile?.view?.state.doc.toString() ?? host?.textContent ?? ''
  })
}

async function hasSelectedEditorNode(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelector('.ProseMirror-selectednode') !== null)
}

async function expectNoEditorNodeSelection(page: Page): Promise<void> {
  expect(await hasSelectedEditorNode(page)).toBe(false)
}

async function applyZoom(page: Page, percent: number): Promise<void> {
  await page.evaluate((pct) => {
    document.documentElement.style.setProperty('zoom', `${pct}%`)
    window.dispatchEvent(new Event('laputa-zoom-change'))
  }, percent)
  await page.waitForTimeout(250)
}

async function firstTldrawShapeOrigin(page: Page): Promise<{ x: number, y: number } | null> {
  return page.locator('.tl-shape').first().evaluate((element) => {
    const whiteboard = element.closest('.tldraw-whiteboard')
    if (!whiteboard) return null

    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    const boardBox = whiteboard.getBoundingClientRect()
    const zoomStyle = document.documentElement.style.getPropertyValue('zoom')
      || getComputedStyle(document.documentElement).zoom
    const parsedZoom = Number.parseFloat(zoomStyle)
    const zoom = Number.isFinite(parsedZoom) && parsedZoom > 0
      ? zoomStyle.endsWith('%') ? parsedZoom / 100 : parsedZoom
      : 1

    return {
      x: boardBox.x + matrix.m41 * zoom,
      y: boardBox.y + matrix.m42 * zoom,
    }
  })
}

test('tldraw whiteboard fences render as embedded canvases and remain Markdown-durable', async ({ page }) => {
  await openNote(page, 'Whiteboard Embed')

  await expect(page.locator('.tldraw-whiteboard')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.tldraw-whiteboard .tl-container')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.bn-editor')).toContainText('Context before the board.')
  await expect(page.locator('.bn-editor')).toContainText('Context after the board.')

  await page.waitForTimeout(500)
  await toggleRawMode(page, '.cm-content')
  const rawAfterRichMode = await getRawEditorContent(page)

  expect(rawAfterRichMode).toContain('```tldraw id="planning-map" height="520"')
  expect(rawAfterRichMode).toContain('{}')
  expect(rawAfterRichMode).not.toContain('@@TOLARIA_TLDRAW')
})

test('embedded tldraw interactions stay inside the whiteboard', async ({ page }) => {
  await openNote(page, 'Whiteboard Embed')

  const whiteboard = page.locator('.tldraw-whiteboard')
  await expect(whiteboard).toBeVisible({ timeout: 20_000 })

  const boardBox = await whiteboard.boundingBox()
  expect(boardBox).not.toBeNull()

  await page.mouse.click(boardBox!.x + boardBox!.width / 2, boardBox!.y + boardBox!.height / 2)
  await expectNoEditorNodeSelection(page)

  await page.getByTestId('tools.select').click()
  await expectNoEditorNodeSelection(page)

  const pageMenuButton = page.getByTestId('page-menu.button')
  const buttonBox = await pageMenuButton.boundingBox()
  expect(buttonBox).not.toBeNull()

  await pageMenuButton.click()

  const pageMenu = page.locator('.tlui-page-menu__wrapper')
  await expect(pageMenu).toBeVisible({ timeout: 5_000 })

  const menuBox = await pageMenu.boundingBox()
  expect(menuBox).not.toBeNull()
  expect(menuBox!.x).toBeGreaterThanOrEqual(boardBox!.x - 1)
  expect(menuBox!.x).toBeLessThanOrEqual(buttonBox!.x + 1)
  await expectNoEditorNodeSelection(page)
})

test('embedded tldraw drawing uses the clicked coordinates while zoomed', async ({ page }) => {
  await openNote(page, 'Whiteboard Embed')
  await applyZoom(page, 110)

  const whiteboard = page.locator('.tldraw-whiteboard')
  await expect(whiteboard).toBeVisible({ timeout: 20_000 })
  const boardBox = await whiteboard.boundingBox()
  expect(boardBox).not.toBeNull()

  await page.getByTestId('tools.draw').click()

  const start = {
    x: boardBox!.x + 180,
    y: boardBox!.y + 180,
  }
  const end = {
    x: start.x + 120,
    y: start.y + 90,
  }

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()

  const shape = page.locator('.tl-shape').first()
  await expect(shape).toBeVisible({ timeout: 5_000 })

  const shapeOrigin = await firstTldrawShapeOrigin(page)
  expect(shapeOrigin).not.toBeNull()
  expect(Math.abs(shapeOrigin!.x - start.x)).toBeLessThan(30)
  expect(Math.abs(shapeOrigin!.y - start.y)).toBeLessThan(30)
})
