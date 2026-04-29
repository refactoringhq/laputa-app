import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { sendShortcut } from './helpers'

let tempVaultDir: string

function missingTypeNotePath(vaultPath: string): string {
  return path.join(vaultPath, 'hotel-guide.md')
}

test.describe('Missing type warning', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    fs.writeFileSync(
      missingTypeNotePath(tempVaultDir),
      '---\ntype: Hotel\nstatus: Active\n---\n# Hotel Guide\n\nMissing type test note.\n',
    )
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await page.setViewportSize({ width: 1600, height: 900 })
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('lets keyboard users inspect, cancel, and create a missing type from the Properties panel', async ({ page }) => {
    await page.getByText('Hotel Guide', { exact: true }).click()
    await sendShortcut(page, 'i', ['Control', 'Shift'])

    const warning = page.getByTestId('missing-type-warning')
    await expect(warning).toBeVisible()
    await expect(warning).toHaveAttribute('aria-label', 'Missing type Hotel. Click to create this type.')

    await warning.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog')
    const typeNameInput = dialog.getByPlaceholder('e.g. Recipe, Book, Habit...')
    await expect(dialog).toBeVisible()
    await expect(typeNameInput).toHaveValue('Hotel')
    await expect(typeNameInput).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(warning).toBeVisible()

    await warning.focus()
    await page.keyboard.press('Enter')
    await expect(typeNameInput).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(warning).toHaveCount(0)
    await expect(page.getByRole('combobox')).toContainText('Hotel')
    await expect.poll(() => fs.existsSync(path.join(tempVaultDir, 'hotel.md'))).toBe(true)

    await page.getByText('Alpha Project', { exact: true }).click()
    await page.getByText('Hotel Guide', { exact: true }).click()
    await expect(page.getByTestId('missing-type-warning')).toHaveCount(0)
  })
})
