import fs from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

function untitledNotesInProject(): string[] {
  const projectDir = path.join(tempVaultDir, 'project')
  return fs.readdirSync(projectDir).filter((name) => /^untitled-note-\d+(?:-\d+)?\.md$/.test(name))
}

test.beforeEach(async ({ page }) => {
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultDesktopHarness(page, tempVaultDir, {
    folders: [{ children: [], name: 'project', path: 'project' }],
  })
  await expect(page.getByTestId('folder-row:project')).toBeVisible({ timeout: 5_000 })
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('creates new notes inside the targeted folder @smoke', async ({ page }) => {
  await page.getByTestId('folder-row:project').click({ button: 'right' })
  await page.getByTestId('create-node-in-folder-menu-item').click()

  await expect.poll(untitledNotesInProject, { timeout: 5_000 }).toHaveLength(1)

  await page.getByTestId('folder-row:project').click()
  await openCommandPalette(page)
  await executeCommand(page, 'Create New Note in Current Folder')

  await expect.poll(untitledNotesInProject, { timeout: 5_000 }).toHaveLength(2)
  for (const filename of untitledNotesInProject()) {
    expect(fs.readFileSync(path.join(tempVaultDir, 'project', filename), 'utf8')).toContain('type: Note')
  }
})
