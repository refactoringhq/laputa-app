import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

function alphaProjectPath(vaultPath: string): string {
  return path.join(vaultPath, 'project', 'alpha-project.md')
}

function plainNotePath(vaultPath: string): string {
  return path.join(vaultPath, 'plain-width-note.md')
}

async function openNote(page: Page, title: string) {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function executePaletteCommand(page: Page, label: string) {
  await openCommandPalette(page)
  await executeCommand(page, label)
}

async function expectWideModeHasUnboundedWidth(page: Page) {
  const metrics = await page.locator('.editor-content-width--wide').evaluate((root) => {
    const wrapper = root.querySelector<HTMLElement>('.editor-content-wrapper')
    const editor = root.querySelector<HTMLElement>('.bn-editor')
    if (!wrapper || !editor) throw new Error('Wide editor layout was not rendered')

    const wrapperStyle = window.getComputedStyle(wrapper)
    const editorStyle = window.getComputedStyle(editor)
    const wrapperRect = wrapper.getBoundingClientRect()
    const editorRect = editor.getBoundingClientRect()
    const wrapperPaddingLeft = Number.parseFloat(wrapperStyle.paddingLeft)
    const wrapperPaddingRight = Number.parseFloat(wrapperStyle.paddingRight)

    return {
      wrapperMaxWidth: wrapperStyle.maxWidth,
      wrapperPaddingLeft,
      wrapperPaddingRight,
      editorMaxWidth: editorStyle.maxWidth,
      editorPaddingLeft: Number.parseFloat(editorStyle.paddingLeft),
      editorPaddingRight: Number.parseFloat(editorStyle.paddingRight),
      editorWidth: editorRect.width,
      wrapperContentWidth: wrapperRect.width - wrapperPaddingLeft - wrapperPaddingRight,
    }
  })

  expect(metrics.wrapperMaxWidth).toBe('none')
  expect(metrics.wrapperPaddingLeft).toBeGreaterThanOrEqual(16)
  expect(metrics.wrapperPaddingRight).toBeGreaterThanOrEqual(16)
  expect(metrics.editorMaxWidth).toBe('none')
  expect(metrics.editorPaddingLeft).toBe(0)
  expect(metrics.editorPaddingRight).toBe(0)
  expect(metrics.editorWidth).toBeGreaterThan(900)
  expect(Math.abs(metrics.editorWidth - metrics.wrapperContentWidth)).toBeLessThan(2)
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  await page.setViewportSize({ width: 1920, height: 1080 })
  tempVaultDir = createFixtureVaultCopy()
  fs.writeFileSync(plainNotePath(tempVaultDir), '# Plain Width Note\n\nNo frontmatter here.\n')
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('note width modes persist only when frontmatter already exists', async ({ page }) => {
  await openNote(page, 'Alpha Project')

  await expect(page.locator('.editor-content-width--normal')).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Switch to wide note width' }).click()
  await expect(page.locator('.editor-content-width--wide')).toBeVisible({ timeout: 5_000 })
  await expectWideModeHasUnboundedWidth(page)
  await expect.poll(() => fs.readFileSync(alphaProjectPath(tempVaultDir), 'utf8')).toMatch(/_width:\s+"?wide"?/)

  await executePaletteCommand(page, 'Use Normal Note Width')
  await expect(page.locator('.editor-content-width--normal')).toBeVisible({ timeout: 5_000 })
  await expect.poll(() => fs.readFileSync(alphaProjectPath(tempVaultDir), 'utf8')).toMatch(/_width:\s+"?normal"?/)

  await openNote(page, 'Plain Width Note')
  await page.getByRole('button', { name: 'Switch to wide note width' }).click()
  await expect(page.locator('.editor-content-width--wide')).toBeVisible({ timeout: 5_000 })
  expect(fs.readFileSync(plainNotePath(tempVaultDir), 'utf8')).toBe('# Plain Width Note\n\nNo frontmatter here.\n')
})
