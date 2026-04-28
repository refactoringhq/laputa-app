import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVault,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { sendShortcut } from './helpers'

let tempVaultDir: string

function isCrashError(message: string): boolean {
  return (
    message.includes('Maximum update depth') ||
    message.includes('React error #185') ||
    message.includes('#185')
  )
}

function collectCrashErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => {
    if (isCrashError(error.message)) errors.push(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error' && isCrashError(message.text())) {
      errors.push(message.text())
    }
  })
  return errors
}

async function openNote(page: Page, title: string) {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
}

async function focusHeadingEnd(page: Page, title: string) {
  const heading = page.getByRole('heading', { name: title, level: 1 })
  await expect(heading).toBeVisible({ timeout: 5_000 })
  await heading.click()
  await page.keyboard.press('End')
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
  await page.setViewportSize({ width: 1180, height: 760 })
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('editing and saving stays stable when truncated labels and tooltips are clicked', async ({ page }) => {
  const errors = collectCrashErrors(page)
  const initialTitle = 'Alpha Project'
  const titleSuffix = ` Loop Guard ${Date.now()}`
  const updatedTitle = `${initialTitle}${titleSuffix}`
  const noteList = page.getByTestId('note-list-container')

  await openNote(page, initialTitle)
  await focusHeadingEnd(page, initialTitle)
  await page.keyboard.type(titleSuffix)
  await sendShortcut(page, 's', ['Control'])

  await expect(page.getByRole('heading', { name: updatedTitle, level: 1 })).toBeVisible({ timeout: 5_000 })
  await expect(noteList.getByText(updatedTitle, { exact: true })).toBeVisible({ timeout: 5_000 })

  await page.getByTestId('breadcrumb-filename-trigger').locator('span.truncate').click()
  await noteList.getByText(updatedTitle, { exact: true }).click()

  const syncButton = page.getByTestId('breadcrumb-sync-button')
  await expect(syncButton).toBeVisible({ timeout: 5_000 })
  await syncButton.hover()
  await syncButton.click()

  await page.getByTestId('breadcrumb-filename-trigger').locator('span.truncate').click()
  expect(errors).toHaveLength(0)
})
