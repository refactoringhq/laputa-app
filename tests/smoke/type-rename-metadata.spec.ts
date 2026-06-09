import fs from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

let tempVaultDir: string

test.beforeEach(async ({ page }) => {
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('changing a type section display name preserves type metadata @smoke', async ({ page }) => {
  await page.getByText('Projects', { exact: true }).dblclick()

  const renameInput = page.getByRole('textbox', { name: 'Section name' })
  await expect(renameInput).toBeVisible({ timeout: 5_000 })
  await renameInput.fill('Initiative')
  await renameInput.press('Enter')

  await expect(page.getByText('Initiative', { exact: true })).toBeVisible({ timeout: 5_000 })

  const oldTypePath = path.join(tempVaultDir, 'type', 'project.md')
  const newTypePath = path.join(tempVaultDir, 'type', 'initiative.md')

  expect(fs.existsSync(oldTypePath)).toBe(true)
  expect(fs.existsSync(newTypePath)).toBe(false)

  const typeContent = fs.readFileSync(oldTypePath, 'utf-8')
  expect(typeContent).toContain('_sidebar_label: "Initiative"')
  expect(typeContent).toContain('# Project')

  const alphaContent = fs.readFileSync(path.join(tempVaultDir, 'project', 'alpha-project.md'), 'utf-8')
  expect(alphaContent).toContain('Is A: Project')
  expect(alphaContent).not.toContain('type: "Project"')
  expect(alphaContent).not.toContain('Initiative')
})
