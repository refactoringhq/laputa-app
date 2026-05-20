import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'

const SOURCE_TITLE = 'Duplicate Attachment Links'
const SOURCE_RELATIVE_PATH = path.join('b', 'note.md')
const YAML_TARGET = path.join('b', 'file.yml')
const YAML_MARKER = 'selected-folder: b'

let tempVaultDir: string

function writeDuplicateLinkFixture(vaultPath: string): void {
  fs.mkdirSync(path.join(vaultPath, 'a'), { recursive: true })
  fs.mkdirSync(path.join(vaultPath, 'b'), { recursive: true })
  fs.writeFileSync(path.join(vaultPath, 'a', 'file.yml'), 'selected-folder: a\n')
  fs.writeFileSync(path.join(vaultPath, 'b', 'file.yml'), `${YAML_MARKER}\n`)
  fs.writeFileSync(path.join(vaultPath, SOURCE_RELATIVE_PATH), `---
type: Note
---
# ${SOURCE_TITLE}

- YAML: [[b/file.yml|b/file.yml]]
`)
}

function buildFileEntry(vaultPath: string, relativePath: string) {
  const filePath = path.join(vaultPath, relativePath)
  const filename = path.basename(filePath)
  return {
    path: filePath,
    filename,
    title: filename,
    isA: null,
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: Date.now(),
    createdAt: null,
    fileSize: fs.statSync(filePath).size,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: null,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: false,
    fileKind: 'text',
  }
}

async function includeNonMarkdownEntries(page: Page, vaultPath: string): Promise<void> {
  const duplicateEntries = [
    buildFileEntry(vaultPath, path.join('a', 'file.yml')),
    buildFileEntry(vaultPath, YAML_TARGET),
  ]
  await page.route('**/api/vault/list*', async (route) => {
    const response = await route.fetch()
    const entries = await response.json()
    if (!Array.isArray(entries)) {
      await route.fulfill({ response })
      return
    }

    const existingPaths = new Set(entries.map((entry) => entry?.path).filter(Boolean))
    const nextEntries = [
      ...entries,
      ...duplicateEntries.filter((entry) => !existingPaths.has(entry.path)),
    ]
    await route.fulfill({ response, json: nextEntries })
  })
}

async function readRawEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('.cm-content')
    if (!host) return ''

    type CodeMirrorHost = Element & {
      cmTile?: {
        view?: {
          state: { doc: { toString(): string } }
        }
      }
    }

    return (host as CodeMirrorHost).cmTile?.view?.state.doc.toString() ?? host.textContent ?? ''
  })
}

test.describe('non-Markdown duplicate wikilinks', () => {
  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
    writeDuplicateLinkFixture(tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('full-path wikilinks open the matching non-Markdown duplicate', async ({ page }) => {
    await includeNonMarkdownEntries(page, tempVaultDir)
    await openFixtureVaultDesktopHarness(page, tempVaultDir, { expectedReadyTitle: SOURCE_TITLE })

    await page.getByText(SOURCE_TITLE, { exact: true }).first().click()
    const link = page.locator('.bn-editor [data-target="b/file.yml|b/file.yml"]').first()
    await expect(link).toBeVisible({ timeout: 5_000 })

    await link.click({ modifiers: ['Meta'] })

    await expect(page.getByTestId('raw-editor-codemirror')).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => readRawEditorContent(page)).toContain(YAML_MARKER)
  })
})
