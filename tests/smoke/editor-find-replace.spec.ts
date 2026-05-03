import { expect, test, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

const FIND_SHORTCUT = process.platform === 'darwin' ? 'Meta+F' : 'Control+F'

let tempVaultDir: string

async function getRawEditorDoc(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="raw-editor-codemirror"]') as (HTMLElement & {
      __cmView?: { state: { doc: { toString(): string } } }
    }) | null
    if (!host?.__cmView) {
      throw new Error('Raw editor CodeMirror view is not mounted')
    }
    return host.__cmView.state.doc.toString()
  })
}

test.describe('editor find and replace', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    tempVaultDir = createFixtureVaultCopy()
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await page.setViewportSize({ width: 1600, height: 900 })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('Cmd+F opens current-note find and supports regex replacement @smoke', async ({ page }) => {
    await page.getByText('Note B', { exact: true }).first().click()
    await page.locator('.bn-editor').click()

    await page.keyboard.press(FIND_SHORTCUT)

    await expect(page.getByTestId('raw-editor-codemirror')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('raw-editor-find-input')).toBeFocused()

    await page.getByRole('button', { name: 'Show replace' }).click()
    await page.getByRole('button', { name: 'Use regular expression' }).click()
    const findInput = page.getByTestId('raw-editor-find-input')
    await findInput.pressSequentially('Note ([BC])')
    await expect(findInput).toBeFocused()
    await expect(findInput).toHaveValue('Note ([BC])')
    await expect(page.getByTestId('raw-editor-find-count')).toContainText('1 / 3')

    await page.getByTestId('raw-editor-replace-input').fill('Entry $1')
    await page.getByRole('button', { name: 'Replace', exact: true }).click()

    await expect.poll(() => getRawEditorDoc(page)).toContain('# Entry B')

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('raw-editor-find-bar')).toHaveCount(0)
    await expect(page.locator('.cm-content')).toBeFocused()
  })
})
