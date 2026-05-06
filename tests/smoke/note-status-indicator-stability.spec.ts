import { test, expect, type Page } from '@playwright/test'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

const STATUS_DOT_SELECTOR = [
  '[data-testid="new-indicator"]',
  '[data-testid="unsaved-indicator"]',
  '[data-testid="pending-save-indicator"]',
].join(',')

interface StatusDotSample {
  className: string | null
  testId: string | null
}

interface StatusDotSampleWindow {
  __noteStatusDotSampler?: number
  __noteStatusDotSamples?: StatusDotSample[]
}

let tempVaultDir: string

async function startStatusDotSampler(page: Page) {
  await page.evaluate((selector) => {
    const sampleWindow = window as typeof window & StatusDotSampleWindow
    sampleWindow.__noteStatusDotSamples = []
    const sample = () => {
      const dot = document.querySelector(selector) as HTMLElement | null
      sampleWindow.__noteStatusDotSamples?.push({
        className: dot?.className ?? null,
        testId: dot?.dataset.testid ?? null,
      })
    }

    sample()
    sampleWindow.__noteStatusDotSampler = window.setInterval(sample, 100)
  }, STATUS_DOT_SELECTOR)
}

async function stopStatusDotSampler(page: Page): Promise<StatusDotSample[]> {
  return page.evaluate(() => {
    const sampleWindow = window as typeof window & StatusDotSampleWindow
    if (sampleWindow.__noteStatusDotSampler !== undefined) {
      window.clearInterval(sampleWindow.__noteStatusDotSampler)
      sampleWindow.__noteStatusDotSampler = undefined
    }
    return sampleWindow.__noteStatusDotSamples ?? []
  })
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('new note status indicator stays steady through typing and autosave', async ({ page }) => {
  await triggerMenuCommand(page, APP_COMMAND_IDS.fileNewNote)
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+/i, {
    timeout: 5_000,
  })
  await expect(page.locator(STATUS_DOT_SELECTOR).first()).toBeVisible({ timeout: 5_000 })

  await startStatusDotSampler(page)
  await page.locator('.bn-editor').click()
  await page.keyboard.type('The sidebar status dot should stay steady while this note is edited. ', {
    delay: 25,
  })
  await page.waitForTimeout(1_800)

  const samples = await stopStatusDotSampler(page)
  expect(samples.length).toBeGreaterThan(0)
  expect(samples.filter((sample) => sample.testId === null)).toEqual([])
  expect(samples.some((sample) => sample.testId === 'unsaved-indicator')).toBe(true)
  expect(samples.filter((sample) => sample.className?.includes('tab-status-pulse'))).toEqual([])
})
