import { test, expect } from '@playwright/test'

test('visual verify: editor theme + list indentation', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto('http://localhost:5173')
  await page.waitForTimeout(1000)

  // Open "Write Weekly Essays" which has bullets, nested items, checkboxes
  const noteItem = page.locator('.note-list__item', { hasText: 'Write Weekly Essays' })
  await noteItem.click()
  await page.waitForTimeout(1000)

  const cmEditor = page.locator('.cm-editor')
  await expect(cmEditor).toBeVisible()

  // No console errors
  expect(consoleErrors).toHaveLength(0)

  // --- BUG 2: Verify list indentation ---

  // Level-0 bullets should have 40px padding-left
  const level0Lines = page.locator('.cm-line.cm-live-list-level-0')
  const level0Count = await level0Lines.count()
  console.log(`Level-0 bullet lines: ${level0Count}`)
  expect(level0Count).toBeGreaterThan(0)

  const paddingL0 = await level0Lines.first().evaluate(el =>
    window.getComputedStyle(el).paddingLeft
  )
  console.log(`Level-0 padding-left: ${paddingL0}`)
  expect(parseInt(paddingL0, 10)).toBe(40)

  // Bullet widgets and checkboxes are rendered
  const bulletCount = await page.locator('.cm-live-bullet').count()
  console.log(`Bullet widgets: ${bulletCount}`)
  expect(bulletCount).toBeGreaterThan(0)

  const checkboxCount = await page.locator('.cm-live-checkbox').count()
  console.log(`Checkbox widgets: ${checkboxCount}`)
  expect(checkboxCount).toBeGreaterThan(0)

  // Screenshot dark mode (top)
  await page.screenshot({ path: 'test-results/01-dark-mode-editor.png', fullPage: true })

  // Scroll down to see nested items section
  const scroller = page.locator('.cm-scroller')
  await scroller.evaluate(el => el.scrollTop = el.scrollHeight)
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/01b-dark-mode-nested.png', fullPage: true })

  // --- BUG 1: Verify theme toggle ---

  // Dark mode: editor bg should be dark
  const darkBg = await cmEditor.evaluate(el =>
    window.getComputedStyle(el).backgroundColor
  )
  console.log(`Dark mode bg: ${darkBg}`)
  expect(darkBg).toBe('rgb(15, 15, 26)')

  // Toggle to light mode
  const themeToggle = page.locator('.sidebar__theme-toggle')
  await themeToggle.click()
  await page.waitForTimeout(500)

  // Scroll back to top for light mode screenshot
  await scroller.evaluate(el => el.scrollTop = 0)
  await page.waitForTimeout(200)
  await page.screenshot({ path: 'test-results/02-light-mode-editor.png', fullPage: true })

  // Light mode: editor bg should be white
  const lightBg = await cmEditor.evaluate(el =>
    window.getComputedStyle(el).backgroundColor
  )
  console.log(`Light mode bg: ${lightBg}`)
  expect(lightBg).toBe('rgb(255, 255, 255)')

  // Heading color should be dark in light mode
  const headingColor = await page.locator('.cm-live-heading').first().evaluate(el =>
    window.getComputedStyle(el).color
  )
  console.log(`Light mode heading color: ${headingColor}`)
  expect(headingColor).toBe('rgb(55, 53, 47)')

  // Scroll to nested items in light mode
  await scroller.evaluate(el => el.scrollTop = el.scrollHeight)
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/02b-light-mode-nested.png', fullPage: true })

  // Toggle back to dark mode
  await themeToggle.click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/03-dark-mode-restored.png', fullPage: true })

  const restoredBg = await cmEditor.evaluate(el =>
    window.getComputedStyle(el).backgroundColor
  )
  console.log(`Restored dark mode bg: ${restoredBg}`)
  expect(restoredBg).toBe('rgb(15, 15, 26)')
})
