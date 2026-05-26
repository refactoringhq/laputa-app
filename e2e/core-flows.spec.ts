import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(500) // Wait for mock data
})

// --- Flow 1: Open app, click note, verify editor shows content ---

test('clicking a note opens it in the editor with content', async ({ page }) => {
  // Click "Build Laputa App" in the note list
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)

  // Tab should appear and be active
  await expect(page.locator('.editor__tab--active')).toHaveText(/Build Laputa App/)

  // Editor should show note content (heading in live preview)
  await expect(page.locator('.cm-editor')).toBeVisible()

  // Inspector should show properties
  await expect(page.locator('.inspector__prop-value', { hasText: 'Project' })).toBeVisible()

  await page.screenshot({ path: 'test-results/core-open-note.png', fullPage: true })
})

test('editor shows markdown content with live preview', async ({ page }) => {
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)

  // CodeMirror should render the content
  const editor = page.locator('.cm-editor')
  await expect(editor).toBeVisible()

  // Should contain the heading text (rendered by live preview)
  await expect(page.locator('.cm-content')).toContainText('Build Laputa App')
})

// --- Flow 2: Sidebar filter changes note list ---

test('sidebar filter: People shows only Person entries', async ({ page }) => {
  await page.locator('.sidebar__filter-item', { hasText: 'People' }).click()
  await page.waitForTimeout(200)

  await expect(page.locator('.note-list__count')).toHaveText('1')
  await expect(page.locator('.note-list__title', { hasText: 'Matteo Cellini' })).toBeVisible()
  await expect(page.locator('.note-list__title', { hasText: 'Build Laputa App' })).not.toBeVisible()
})

test('sidebar filter: Events shows only Event entries', async ({ page }) => {
  await page.locator('.sidebar__filter-item', { hasText: 'Events' }).click()
  await page.waitForTimeout(200)

  await expect(page.locator('.note-list__count')).toHaveText('1')
  await expect(page.locator('.note-list__title', { hasText: 'Laputa App Design Session' })).toBeVisible()
})

test('sidebar filter: clicking back to All Notes restores full list', async ({ page }) => {
  await page.locator('.sidebar__filter-item', { hasText: 'People' }).click()
  await page.waitForTimeout(200)
  await expect(page.locator('.note-list__count')).toHaveText('1')

  await page.locator('.sidebar__filter-item', { hasText: 'All Notes' }).click()
  await page.waitForTimeout(200)
  await expect(page.locator('.note-list__count')).toHaveText('12')
})

// --- Flow 3: Search for a note ---

test('search filters notes by title', async ({ page }) => {
  await page.fill('.note-list__search-input', 'stock')
  await page.waitForTimeout(200)

  await expect(page.locator('.note-list__count')).toHaveText('1')
  await expect(page.locator('.note-list__title', { hasText: 'Stock Screener' })).toBeVisible()
  await expect(page.locator('.note-list__title', { hasText: 'Build Laputa App' })).not.toBeVisible()
})

test('clearing search restores all results', async ({ page }) => {
  await page.fill('.note-list__search-input', 'stock')
  await page.waitForTimeout(200)
  await expect(page.locator('.note-list__count')).toHaveText('1')

  await page.fill('.note-list__search-input', '')
  await page.waitForTimeout(200)
  await expect(page.locator('.note-list__count')).toHaveText('12')
})

// --- Flow 4: Open multiple tabs and switch between them ---

test('opening multiple notes creates multiple tabs', async ({ page }) => {
  // Open first note
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)

  // Open second note
  await page.locator('.note-list__item', { hasText: 'Grow Newsletter' }).click()
  await page.waitForTimeout(300)

  // Both tabs should exist
  const tabs = page.locator('.editor__tab')
  await expect(tabs).toHaveCount(2)

  // Second tab should be active
  await expect(page.locator('.editor__tab--active')).toHaveText(/Grow Newsletter/)

  await page.screenshot({ path: 'test-results/core-multi-tabs.png', fullPage: true })
})

test('clicking a tab switches to it', async ({ page }) => {
  // Open two notes
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)
  await page.locator('.note-list__item', { hasText: 'Grow Newsletter' }).click()
  await page.waitForTimeout(300)

  // Switch back to first tab
  await page.locator('.editor__tab', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(200)

  // First tab should now be active
  await expect(page.locator('.editor__tab--active')).toHaveText(/Build Laputa App/)

  // Editor should show first note's content
  await expect(page.locator('.cm-content')).toContainText('Build Laputa App')
})

test('closing a tab removes it and switches to adjacent', async ({ page }) => {
  // Open two notes
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)
  await page.locator('.note-list__item', { hasText: 'Grow Newsletter' }).click()
  await page.waitForTimeout(300)

  // Close active tab (Grow Newsletter)
  await page.locator('.editor__tab--active .editor__tab-close').click()
  await page.waitForTimeout(200)

  // Should have 1 tab left
  await expect(page.locator('.editor__tab')).toHaveCount(1)
  await expect(page.locator('.editor__tab--active')).toHaveText(/Build Laputa App/)
})

// --- Flow 5: Inspector shows correct properties ---

test('inspector shows properties for selected note', async ({ page }) => {
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)

  // Type
  await expect(page.locator('.inspector__prop-value', { hasText: 'Project' })).toBeVisible()
  // Status
  await expect(page.locator('.inspector__status-pill', { hasText: 'Active' })).toBeVisible()
  // Owner
  await expect(page.locator('.inspector__prop-value', { hasText: 'Luca Rossi' })).toBeVisible()

  await page.screenshot({ path: 'test-results/core-inspector.png', fullPage: true })
})

test('inspector shows relationships', async ({ page }) => {
  // Open a note with relationships
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)

  // Should show "Related to" relationships
  await expect(page.locator('.inspector__section', { hasText: 'Relationships' })).toBeVisible()
})

test('inspector shows backlinks', async ({ page }) => {
  // Open a note that has backlinks (Build Laputa App is referenced by Facebook Ads and Budget Allocation)
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)

  // Backlinks section should show
  const backlinksSection = page.locator('.inspector__section', { hasText: 'Backlinks' })
  await expect(backlinksSection).toBeVisible()
})

test('inspector shows git history', async ({ page }) => {
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)

  // Should show commits
  await expect(page.locator('.inspector__commit-hash').first()).toBeVisible()
  await expect(page.locator('.inspector__commit-msg').first()).toContainText('26q1-laputa-app')
})

test('inspector updates when switching tabs', async ({ page }) => {
  // Open first note
  await page.locator('.note-list__item', { hasText: 'Build Laputa App' }).click()
  await page.waitForTimeout(300)
  await expect(page.locator('.inspector__prop-value', { hasText: 'Project' })).toBeVisible()

  // Open second note with different type — use title locator for precision
  await page.locator('.note-list__item').filter({ has: page.locator('.note-list__title', { hasText: 'Matteo Cellini' }) }).click()
  await page.waitForTimeout(300)
  await expect(page.locator('.inspector__prop-value', { hasText: 'Person' })).toBeVisible()
})

// --- Flow 6: Note list preview snippets ---

test('note list items show preview snippets', async ({ page }) => {
  // Check that snippets are visible
  const snippet = page.locator('.note-list__snippet').first()
  await expect(snippet).toBeVisible()
  // Snippet should have some text content
  const text = await snippet.textContent()
  expect(text!.length).toBeGreaterThan(10)
})

// --- Flow 7: Create note and verify it appears ---

test('full create note flow', async ({ page }) => {
  // Count before
  const countBefore = await page.locator('.note-list__count').textContent()

  // Create new note
  await page.click('.note-list__add-btn')
  await page.waitForTimeout(200)
  await page.fill('.create-dialog__input', 'E2E Test Note')
  await page.click('.create-dialog__type-btn:text("Experiment")')
  await page.click('.create-dialog__btn--create')
  await page.waitForTimeout(500)

  // Count should increase
  const countAfter = await page.locator('.note-list__count').textContent()
  expect(parseInt(countAfter!, 10)).toBe(parseInt(countBefore!, 10) + 1)

  // Note should be opened in editor
  await expect(page.locator('.editor__tab--active')).toHaveText(/E2E Test Note/)

  await page.screenshot({ path: 'test-results/core-create-note.png', fullPage: true })
})

// --- Flow 8: Wiki-link navigation ---

test('clicking a wikilink opens the target note in a new tab', async ({ page }) => {
  // Open "Manage Sponsorships" which contains [[Matteo Cellini]] wikilink
  await page.locator('.note-list__item', { hasText: 'Manage Sponsorships' }).click()
  await page.waitForTimeout(300)

  // Verify we opened the right note
  await expect(page.locator('.editor__tab--active')).toHaveText(/Manage Sponsorships/)

  // Click the wikilink — use mouse.click to fire real mousedown
  const wikilink = page.locator('.cm-wikilink', { hasText: 'Matteo Cellini' })
  await expect(wikilink).toBeVisible()
  const box = await wikilink.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.waitForTimeout(300)

  // New tab should open with the target note active
  await expect(page.locator('.editor__tab--active')).toHaveText(/Matteo Cellini/)

  // Editor should show the target note's content
  await expect(page.locator('.cm-content')).toContainText('Matteo Cellini')

  await page.screenshot({ path: 'test-results/core-wikilink-nav.png', fullPage: true })
})
