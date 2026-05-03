import { test, expect } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

test('opens a non-git vault and initializes Git later from the keyboard @smoke', async ({ page }) => {
  const tempVaultDir = createFixtureVaultCopy()

  try {
    await openFixtureVault(page, tempVaultDir, { isGitRepo: false })

    await expect(page.getByTestId('note-list-container')).toBeVisible()
    await expect(page.getByText('Alpha Project', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Enable Git for this vault?' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Enable Git for this vault?' })).not.toBeVisible()
    await expect(page.getByTestId('status-missing-git')).toContainText('Git disabled')

    await openCommandPalette(page)
    await executeCommand(page, 'Initialize Git')

    await expect(page.getByRole('heading', { name: 'Enable Git for this vault?' })).toBeVisible()
    await page.getByRole('button', { name: 'Initialize Git' }).focus()
    await page.keyboard.press('Enter')

    await expect(page.getByRole('heading', { name: 'Enable Git for this vault?' })).not.toBeVisible()
    await expect(page.getByTestId('status-missing-git')).not.toBeVisible()
    await expect(page.getByTestId('status-pulse')).toBeVisible()
  } finally {
    removeFixtureVaultCopy(tempVaultDir)
  }
})
