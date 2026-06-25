import { type Page, test } from '@playwright/test'

const SCREENSHOT_PATH = '/Users/luca/OpenClaw/ai-chat-final.jpg'

async function clickNoteListItem(page: Page): Promise<string> {
  return page.evaluate(() => {
    const items = document.querySelectorAll('[class*="cursor-pointer"]')
    const noteListItem = Array.from(items).find((el) => {
      const rect = el.getBoundingClientRect()
      return rect.x > 249 && rect.x < 700 && rect.height > 40 && rect.width > 200
    })

    if (!noteListItem) {
      return 'Nothing found'
    }

    const noteListElement = noteListItem as HTMLElement
    noteListElement.click()
    const rect = noteListItem.getBoundingClientRect()
    return `Clicked: ${noteListItem.textContent?.trim().slice(0, 50)} at x=${rect.x}`
  })
}

async function clickAiToolbarButton(page: Page): Promise<string> {
  return page.evaluate(() => {
    const aiButton = Array.from(document.querySelectorAll('button')).find((btn) =>
      btn.title?.includes('AI'),
    )

    if (!aiButton) {
      return 'AI button not found'
    }

    aiButton.click()
    return `Clicked: ${aiButton.title}`
  })
}

test('screenshot AI chat panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(3000)

  // Click a note item in the NoteList (x > 243, past the sidebar)
  // Note items have: cursor-pointer border-b border-[var(--border)]
  const clicked = await clickNoteListItem(page)
  console.log('Note click result:', clicked)
  await page.waitForTimeout(1200)

  // Now find and click the AI button in the editor toolbar
  const aiBtn = await clickAiToolbarButton(page)
  console.log('AI btn result:', aiBtn)
  await page.waitForTimeout(800)

  await page.screenshot({ path: SCREENSHOT_PATH, type: 'jpeg', quality: 90 })
  console.log('Done')
})
