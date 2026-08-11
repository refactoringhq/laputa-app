import { expect, type Locator, type Page, test } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

interface FixtureMoveArgs {
  oldPath: string
  folderPath: string
}

interface MockMoveArgs {
  old_path: string
  folder_path: string
}

type RetargetingTestWindow = typeof window & {
  __mockHandlers?: Record<string, (args?: unknown) => unknown>
  __noteRetargetingTransfer?: DataTransfer
  fixtureMoveNoteToFolder?: (args: FixtureMoveArgs) => Promise<{
    new_path: string
    updated_files: number
    failed_updates: number
  }>
}

let tempVaultDir: string

function noteBPath(folder = 'note'): string {
  return `${tempVaultDir}/${folder}/note-b.md`
}

function noteBRow(page: Page): Locator {
  return page.locator('[data-note-path$="/note/note-b.md"]')
}

async function startNoteDrag(source: Locator, targetSelector: string): Promise<void> {
  await source.evaluate((sourceElement, selector) => {
    const target = document.querySelector<HTMLElement>(selector)
    if (!target) throw new Error('Retargeting drag target is unavailable')
    const dataTransfer = new DataTransfer()
    const testWindow = window as RetargetingTestWindow
    testWindow.__noteRetargetingTransfer = dataTransfer
    sourceElement.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer }))
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer }))
  }, targetSelector)
}

async function finishNoteDrop(page: Page, targetSelector: string): Promise<void> {
  await page.evaluate((selector) => {
    const target = document.querySelector<HTMLElement>(selector)
    const testWindow = window as RetargetingTestWindow
    const dataTransfer = testWindow.__noteRetargetingTransfer
    if (!target || !dataTransfer) throw new Error('Retargeting drop fixture is unavailable')
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
  }, targetSelector)
}

async function selectAllNotes(page: Page): Promise<void> {
  await page.getByTestId('sidebar-top-nav').getByText('All Notes', { exact: true }).click()
  await expect(noteBRow(page)).toBeVisible({ timeout: 5_000 })
}

async function readFixtureNote(page: Page, notePath: string): Promise<string> {
  const response = await page.request.get(`/api/vault/content?path=${encodeURIComponent(notePath)}`)
  expect(response.ok()).toBe(true)
  const payload = await response.json() as { content: string }
  return payload.content
}

test.describe('note-list retargeting', () => {
  test.setTimeout(90_000)

  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    await page.exposeFunction('fixtureMoveNoteToFolder', async ({ oldPath, folderPath }: FixtureMoveArgs) => {
      const content = await readFixtureNote(page, oldPath)
      const filename = oldPath.slice(oldPath.lastIndexOf('/') + 1)
      const destination = `${tempVaultDir}/${folderPath}/${filename}`
      const saveResponse = await page.request.post('/api/vault/save', {
        data: { path: destination, content },
      })
      expect(saveResponse.ok()).toBe(true)
      const deleteResponse = await page.request.post('/api/vault/delete', {
        data: { path: oldPath },
      })
      expect(deleteResponse.ok()).toBe(true)
      return { new_path: destination, updated_files: 0, failed_updates: 0 }
    })
    await openFixtureVault(page, tempVaultDir, {
      expectedReadyTitle: 'Team Meeting',
      folders: [{ name: 'project', path: 'project', children: [] }],
    })
    await page.evaluate(() => {
      const testWindow = window as RetargetingTestWindow
      if (!testWindow.__mockHandlers || !testWindow.fixtureMoveNoteToFolder) {
        throw new Error('Fixture move handler is unavailable')
      }
      testWindow.__mockHandlers.move_note_to_folder = (args) => {
        const moveArgs = args as MockMoveArgs
        return testWindow.fixtureMoveNoteToFolder?.({
          oldPath: moveArgs.old_path,
          folderPath: moveArgs.folder_path,
        })
      }
    })
    await expect(page.locator('[data-note-drop-folder="project"]')).toBeVisible({ timeout: 5_000 })
    await selectAllNotes(page)
  })

  test.afterEach(() => removeFixtureVaultCopy(tempVaultDir))

  test('assigns a Type, moves into a Folder, and persists both after reload', async ({ page }) => {
    const typeSelector = '[data-note-drop-type="Project"]'
    const folderSelector = '[data-note-drop-folder="project"]'
    const typeTarget = page.locator(typeSelector)
    const folderTarget = page.locator(folderSelector)

    await startNoteDrag(noteBRow(page), typeSelector)
    await expect(typeTarget).toHaveAttribute('data-note-drop-state', 'valid')
    await finishNoteDrop(page, typeSelector)
    await expect(typeTarget).not.toHaveAttribute('data-note-drop-state')
    await expect.poll(() => readFixtureNote(page, noteBPath())).toMatch(/type:\s+Project/)

    await startNoteDrag(noteBRow(page), typeSelector)
    await expect(typeTarget).not.toHaveAttribute('data-note-drop-state')

    await startNoteDrag(noteBRow(page), folderSelector)
    await expect(folderTarget).toHaveAttribute('data-note-drop-state', 'valid')
    await finishNoteDrop(page, folderSelector)
    await expect(folderTarget).not.toHaveAttribute('data-note-drop-state')
    await expect.poll(async () => (await page.request.get(
      `/api/vault/content?path=${encodeURIComponent(noteBPath('project'))}`,
    )).ok()).toBe(true)
    expect((await page.request.get(`/api/vault/content?path=${encodeURIComponent(noteBPath())}`)).ok()).toBe(false)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('sidebar-top-nav')).toBeVisible({
      timeout: 15_000,
    })
    await page.getByTestId('sidebar-top-nav').getByText('All Notes', { exact: true }).click()
    await expect(page.locator(`[data-note-path="${noteBPath('project')}"]`)).toBeVisible({ timeout: 10_000 })
    expect(await readFixtureNote(page, noteBPath('project'))).toMatch(/type:\s+Project/)
  })
})
