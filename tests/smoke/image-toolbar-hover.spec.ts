import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { openCommandPalette, executeCommand } from './helpers'

const IMAGE_DATA_URL =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22180%22%20height%3D%22100%22%20viewBox%3D%220%200%20180%20100%22%3E%3Crect%20width%3D%22180%22%20height%3D%22100%22%20rx%3D%2212%22%20fill%3D%22%232f6fed%22%2F%3E%3Ccircle%20cx%3D%22134%22%20cy%3D%2236%22%20r%3D%2218%22%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.9%22%2F%3E%3Cpath%20d%3D%22M18%2082l42-38%2030%2026%2020-18%2052%2030z%22%20fill%3D%22%23ffffff%22%20fill-opacity%3D%220.82%22%2F%3E%3C%2Fsvg%3E'

let tempVaultDir: string

async function openNote(page: Page, title: string) {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function openRawMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 })
}

async function openBlockNoteMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function getRawEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    if (!el) return ''

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CodeMirror view is attached to the DOM node.
    const view = (el as any).cmTile?.view
    if (!view) return el.textContent ?? ''

    return view.state.doc.toString() as string
  })
}

async function setRawEditorContent(page: Page, content: string) {
  await page.evaluate((nextContent) => {
    const el = document.querySelector('.cm-content')
    if (!el) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CodeMirror view is attached to the DOM node.
    const view = (el as any).cmTile?.view
    if (!view) return

    const fullDocumentRange = { from: 0, to: view.state.doc.length }
    view.dispatch({
      changes: { ...fullDocumentRange, insert: nextContent },
    })
  }, content)
}

async function seedImageBlock(page: Page) {
  await openNote(page, 'Note B')
  await openRawMode(page)

  const rawContent = await getRawEditorContent(page)
  const imageMarkdown = `\n\n![Toolbar hover regression](${IMAGE_DATA_URL})\n`
  await setRawEditorContent(page, `${rawContent}${imageMarkdown}`)
  await page.waitForTimeout(700)

  await openBlockNoteMode(page)

  const image = page.locator('.bn-editor img.bn-visual-media').last()
  await expect(image).toBeVisible({ timeout: 5_000 })
  return image
}

async function moveMouseInSteps(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { steps, stepDelayMs }: { steps: number; stepDelayMs: number },
) {
  await page.mouse.move(from.x, from.y)

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps
    await page.mouse.move(
      from.x + (to.x - from.x) * progress,
      from.y + (to.y - from.y) * progress,
    )
    await page.waitForTimeout(stepDelayMs)
  }
}

async function expectImageBlockSelected(image: ReturnType<Page['locator']>) {
  await expect.poll(async () => (
    image.evaluate((node) => Boolean(node.closest('.ProseMirror-selectednode')))
  )).toBe(true)
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('image toolbar stays usable while the pointer crosses onto its controls', async ({ page }) => {
  const image = await seedImageBlock(page)

  const toolbar = page.locator('.bn-formatting-toolbar')
  const downloadButton = page.getByRole('button', { name: /Download image/i })

  const imageBox = await image.boundingBox()
  expect(imageBox).not.toBeNull()

  await page.mouse.click(
    imageBox!.x + imageBox!.width / 2,
    imageBox!.y + imageBox!.height / 2,
  )

  await expect(toolbar).toBeVisible({ timeout: 5_000 })
  await expect(downloadButton).toBeVisible()
  await expectImageBlockSelected(image)

  const downloadButtonBox = await downloadButton.boundingBox()
  expect(downloadButtonBox).not.toBeNull()
  const toolbarBox = await toolbar.boundingBox()
  expect(toolbarBox).not.toBeNull()

  await moveMouseInSteps(
    page,
    {
      x: imageBox!.x + imageBox!.width / 2,
      y: imageBox!.y + imageBox!.height / 2,
    },
    {
      x: toolbarBox!.x + toolbarBox!.width / 2,
      y: toolbarBox!.y + toolbarBox!.height + 10,
    },
    { steps: 12, stepDelayMs: 35 },
  )

  await page.waitForTimeout(180)
  await expect(toolbar).toBeVisible()
  await expect(downloadButton).toBeVisible()
  await expectImageBlockSelected(image)

  await moveMouseInSteps(
    page,
    {
      x: toolbarBox!.x + toolbarBox!.width / 2,
      y: toolbarBox!.y + toolbarBox!.height + 10,
    },
    {
      x: downloadButtonBox!.x + downloadButtonBox!.width / 2,
      y: downloadButtonBox!.y + downloadButtonBox!.height / 2,
    },
    { steps: 12, stepDelayMs: 35 },
  )

  await expect(toolbar).toBeVisible()
  await expect(downloadButton).toBeVisible()
  await expectImageBlockSelected(image)

  await downloadButton.click()
})
