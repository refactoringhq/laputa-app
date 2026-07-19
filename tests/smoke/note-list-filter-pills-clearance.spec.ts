import { test, expect, type Page } from '@playwright/test'

interface ClearanceSample {
  atBottom: boolean
  scrollHeight: number
  overlap: number
}

async function sampleBottomClearance(page: Page): Promise<ClearanceSample> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="note-list-container"] [data-testid="virtuoso-scroller"]')
    if (!scroller) throw new Error('Note list scroller is unavailable')

    const pills = document.querySelector<HTMLElement>('[data-testid="filter-pills"]')
    if (!pills) throw new Error('Filter pills are unavailable')

    const rows = scroller.querySelectorAll<HTMLElement>('.cursor-pointer')
    const lastRow = rows.item(rows.length - 1)
    if (!lastRow) throw new Error('Note list has no visible rows')

    scroller.scrollTop = scroller.scrollHeight
    return {
      atBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 1,
      scrollHeight: scroller.scrollHeight,
      overlap: lastRow.getBoundingClientRect().bottom - pills.getBoundingClientRect().top,
    }
  })
}

function settledOverlap(sample: ClearanceSample, previousHeight: number): number {
  if (!sample.atBottom) return Number.POSITIVE_INFINITY
  if (sample.scrollHeight !== previousHeight) return Number.POSITIVE_INFINITY
  return sample.overlap
}

async function gotoReadyApp(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 15_000 })
      await expect(page.getByTestId('note-list-container')).toBeVisible({ timeout: 5_000 })
      return
    } catch (error) {
      if (attempt === 5) throw error
      await page.waitForTimeout(250)
    }
  }
}

test.describe('Note list filter pills clearance', () => {
  test.describe.configure({ timeout: 150_000 })

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/vault/ping', route => route.fulfill({ status: 503 }))
    await gotoReadyApp(page)
  })

  test('last note in a type view scrolls fully above the Open/Archived pills', async ({ page }) => {
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    const pills = page.getByTestId('filter-pills')
    await expect(pills).toBeVisible({ timeout: 3_000 })

    const scroller = page.locator('[data-testid="note-list-container"] [data-testid="virtuoso-scroller"]')
    await expect(scroller).toBeVisible({ timeout: 3_000 })

    let settledHeight = -1
    await expect.poll(async () => {
      const sample = await sampleBottomClearance(page)
      const overlap = settledOverlap(sample, settledHeight)
      settledHeight = sample.scrollHeight
      return overlap
    }, { timeout: 10_000 }).toBeLessThanOrEqual(0.5)
  })
})
