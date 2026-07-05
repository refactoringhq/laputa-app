import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { openCommandPalette, executeCommand } from './helpers'

let tempVaultDir: string

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string) {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function openRawMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 5_000 })
}

async function openBlockNoteMode(page: Page) {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function getRawEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    type CodeMirrorHost = Element & {
      cmTile?: {
        view?: {
          state: {
            doc: {
              toString(): string
            }
          }
        }
      }
    }

    const el = document.querySelector('.cm-content')
    if (!el) return ''
    const view = (el as CodeMirrorHost).cmTile?.view
    if (view) return view.state.doc.toString() as string
    return el.textContent ?? ''
  })
}

async function setRawEditorContent(page: Page, content: string) {
  await page.evaluate((nextContent) => {
    type CodeMirrorHost = Element & {
      cmTile?: {
        view?: {
          dispatch: (transaction: { changes: { from: number; to: number; insert: string } }) => void
          state: {
            doc: {
              length: number
            }
          }
        }
      }
    }

    const el = document.querySelector('.cm-content')
    const view = el ? (el as CodeMirrorHost).cmTile?.view : null
    if (!view) return

    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: nextContent,
      },
    })
  }, content)
}

async function roundTripThroughAnotherNote(page: Page) {
  await openNote(page, 'Note C')
  await openNote(page, 'Note B')
}

async function selectWord(page: Page, blockIndex: number, word: string) {
  const block = page.locator('.bn-block-content').nth(blockIndex)
  await expect(block).toBeVisible({ timeout: 5_000 })

  const selected = await block.evaluate((element, targetWord) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)

    while (walker.nextNode()) {
      const node = walker.currentNode
      const content = node.textContent ?? ''
      const index = content.indexOf(targetWord)

      if (index === -1) continue

      const selection = window.getSelection()
      if (!selection) return false

      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + targetWord.length)
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))

      return true
    }

    return false
  }, word)

  expect(selected).toBe(true)
  await expect(page.locator('.bn-formatting-toolbar')).toBeVisible({ timeout: 5_000 })
}

async function openBlockTypeMenu(page: Page) {
  const blockTypeButton = page.getByRole('button', { name: 'Paragraph' })
  await blockTypeButton.focus()
  await page.keyboard.press('Enter')
}

async function assertSlashMenuBlockCommandPersists(page: Page, options: {
  query: string
  optionName: RegExp
  insertedText: string
  rawAssertion: (raw: string) => void
  blockContentType: string
}) {
  await openNote(page, 'Note B')
  await page.locator('.bn-block-content').nth(1).click()
  await page.keyboard.type(options.query)
  await expect(page.getByRole('option', { name: options.optionName })).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type(options.insertedText)
  await page.waitForTimeout(700)

  await roundTripThroughAnotherNote(page)
  await openRawMode(page)

  const raw = await getRawEditorContent(page)
  options.rawAssertion(raw)

  await openBlockNoteMode(page)
  await expect(
    page.locator(
      `.bn-block-content[data-content-type="${options.blockContentType}"]`,
    ).first(),
  ).toContainText(options.insertedText)
}

async function assertKeyboardBoldPersists(page: Page, options: {
  selectionText: string
  rawIncludes: string
  rawExcludes?: string
}) {
  await openNote(page, 'Note B')
  await selectWord(page, 1, options.selectionText)
  await page.keyboard.press('Meta+b')
  await page.waitForTimeout(700)

  await roundTripThroughAnotherNote(page)
  await openRawMode(page)

  const raw = await getRawEditorContent(page)
  expect(raw).toContain(options.rawIncludes)
  if (options.rawExcludes) {
    expect(raw).not.toContain(options.rawExcludes)
  }
}

const slashMenuPersistenceScenarios = [
  {
    name: 'slash menu block commands persist bullet lists',
    query: '/bul',
    optionName: /Bullet List/i,
    insertedText: 'Persisted bullet',
    rawAssertion: (raw: string) => {
      expect(raw).toContain('- Persisted bullet')
    },
    blockContentType: 'bulletListItem',
  },
  {
    name: 'slash menu block commands persist code blocks',
    query: '/code',
    optionName: /Code Block/i,
    insertedText: 'const persistedAnswer = 42',
    rawAssertion: (raw: string) => {
      expect(raw).toMatch(/```[\w-]*\nconst persistedAnswer = 42/m)
    },
    blockContentType: 'codeBlock',
  },
  {
    name: 'slash menu code blocks preserve literal markdown characters',
    query: '/code',
    optionName: /Code Block/i,
    insertedText: 'container_name USER_UID markdown_chars=*_{}<>()#!',
    rawAssertion: (raw: string) => {
      expect(raw).toContain('container_name USER_UID markdown_chars=*_{}<>()#!')
      expect(raw).not.toContain('container\\_name')
      expect(raw).not.toContain('USER\\_UID')
      expect(raw).not.toContain('markdown\\_chars')
    },
    blockContentType: 'codeBlock',
  },
] as const

test('toolbar only exposes audited markdown-safe formatting controls', async ({ page }) => {
  await openNote(page, 'Note B')
  await selectWord(page, 1, 'referenced')

  await expect(page.getByRole('button', { name: 'Paragraph' })).toBeVisible()
  await expect(page.locator('.bn-formatting-toolbar [data-test="bold"]')).toBeVisible()
  await expect(page.locator('.bn-formatting-toolbar [data-test="italic"]')).toBeVisible()
  await expect(page.locator('.bn-formatting-toolbar [data-test="code"]')).toBeVisible()
  await expect(page.locator('.bn-formatting-toolbar [data-test="highlight"]')).toBeVisible()
  await expect(page.locator('.bn-formatting-toolbar [data-test="strike"]')).toBeVisible()
  await expect(page.locator('.bn-formatting-toolbar [data-test="createLink"]')).toBeVisible()

  await openBlockTypeMenu(page)
  await expect(page.getByRole('menuitem', { name: 'Heading 1' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Heading 6' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Quote' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Bullet List' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Numbered List' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Checklist' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Code Block' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Toggle List' })).toHaveCount(0)

  await expect(page.locator('.bn-formatting-toolbar [data-test="underline"]')).toHaveCount(0)
  await expect(page.locator('.bn-formatting-toolbar [data-test="colors"]')).toHaveCount(0)
  await expect(page.locator('.bn-formatting-toolbar [data-test="alignTextLeft"]')).toHaveCount(0)
  await expect(page.locator('.bn-formatting-toolbar [data-test="alignTextCenter"]')).toHaveCount(0)
  await expect(page.locator('.bn-formatting-toolbar [data-test="alignTextRight"]')).toHaveCount(0)
})

test('supported inline formatting persists after note switches when applied from keyboard', async ({ page }) => {
  await assertKeyboardBoldPersists(page, {
    selectionText: 'referenced',
    rawIncludes: 'This is Note B, **referenced** by Alpha Project.',
  })
})

test('bold formatting keeps trailing whitespace outside markdown markers', async ({ page }) => {
  await assertKeyboardBoldPersists(page, {
    selectionText: 'referenced ',
    rawIncludes: 'This is Note B, **referenced** by Alpha Project.',
    rawExcludes: '**referenced **',
  })
})

test('Obsidian-style highlight markdown renders and persists', async ({ page }) => {
  await openNote(page, 'Note B')
  await openRawMode(page)
  const raw = await getRawEditorContent(page)
  const highlightedLine = 'Plain ==marked== text.'
  await setRawEditorContent(page, `${raw.trimEnd()}\n\n${highlightedLine}\n`)

  await openBlockNoteMode(page)
  await expect(page.locator('.bn-editor mark.markdown-highlight', { hasText: 'marked' })).toBeVisible()
  await expect(page.locator('.bn-editor')).not.toContainText('==marked==')

  await roundTripThroughAnotherNote(page)
  await openRawMode(page)
  expect(await getRawEditorContent(page)).toContain(highlightedLine)
})

test('Obsidian-style highlight markdown typed in rich mode renders and persists', async ({ page }) => {
  await openNote(page, 'Note B')

  const block = page.locator('.bn-block-content').nth(1)
  await block.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Plain ==rich-marked==')

  await expect(page.locator('.bn-editor mark.markdown-highlight', { hasText: 'rich-marked' })).toBeVisible()
  await expect(block).not.toContainText('==rich-marked==')

  await roundTripThroughAnotherNote(page)
  await openRawMode(page)

  expect(await getRawEditorContent(page)).toContain('Plain ==rich-marked==')
})

test('toolbar highlight button toggles selected text and persists removal', async ({ page }) => {
  await openNote(page, 'Note B')
  await selectWord(page, 1, 'referenced')

  await page.locator('.bn-formatting-toolbar [data-test="highlight"]').click()
  await expect(page.locator('.bn-editor mark.markdown-highlight', { hasText: 'referenced' })).toBeVisible()

  await roundTripThroughAnotherNote(page)
  await openRawMode(page)
  expect(await getRawEditorContent(page)).toContain('This is Note B, ==referenced== by Alpha Project.')

  await openBlockNoteMode(page)
  await selectWord(page, 1, 'referenced')
  await page.locator('.bn-formatting-toolbar [data-test="highlight"]').click()
  await expect(page.locator('.bn-editor mark.markdown-highlight', { hasText: 'referenced' })).toHaveCount(0)

  await roundTripThroughAnotherNote(page)
  await openRawMode(page)
  const raw = await getRawEditorContent(page)
  expect(raw).toContain('This is Note B, referenced by Alpha Project.')
  expect(raw).not.toContain('==referenced==')
})

test('toolbar block-type commands persist numbered lists', async ({ page }) => {
  await openNote(page, 'Note B')
  await selectWord(page, 1, 'This')
  await openBlockTypeMenu(page)
  await page.getByRole('menuitem', { name: 'Numbered List' }).click()
  await page.waitForTimeout(700)

  await roundTripThroughAnotherNote(page)
  await openRawMode(page)

  const raw = await getRawEditorContent(page)
  expect(raw).toContain('1. This is Note B, referenced by Alpha Project.')

  await openBlockNoteMode(page)
  await expect(page.locator('.bn-block-content[data-content-type="numberedListItem"]').first()).toContainText(
    'This is Note B, referenced by Alpha Project.',
  )
})

for (const scenario of slashMenuPersistenceScenarios) {
  test(scenario.name, async ({ page }) => {
    await assertSlashMenuBlockCommandPersists(page, scenario)
  })
}
