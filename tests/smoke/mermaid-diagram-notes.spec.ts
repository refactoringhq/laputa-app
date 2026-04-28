import { expect, test, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'

let tempVaultDir: string

const FIRST_DIAGRAM = [
  '```mermaid',
  'flowchart LR',
  '  A[Draft] --> B[Saved]',
  '```',
].join('\n')
const UPDATED_FIRST_DIAGRAM = FIRST_DIAGRAM.replace('B[Saved]', 'C[Published]')
const SECOND_DIAGRAM = [
  '```mermaid',
  'sequenceDiagram',
  '  Alice->>Bob: Hello',
  '```',
].join('\n')
const SYSTEM_OVERVIEW_DIAGRAM = [
  '```mermaid',
  'flowchart TD',
  '    subgraph TW["Tauri v2 Window"]',
  '        subgraph FE["React Frontend"]',
  '            App["App.tsx (orchestrator)"]',
  '            WS["WelcomeScreen\\n(onboarding)"]',
  '            SB["Sidebar\\n(navigation + filters + types)"]',
  '            NL["NoteList / PulseView\\n(filtered list / activity)"]',
  '            ED["Editor\\n(BlockNote + diff + raw)"]',
  '            IN["Inspector\\n(metadata + relationships)"]',
  '            AIP["AiPanel\\n(selected CLI agent + tools)"]',
  '            SP["SearchPanel\\n(keyword search)"]',
  '            ST["StatusBar\\n(vault picker + sync + version)"]',
  '            CP["CommandPalette\\n(Cmd+K launcher)"]',
  '',
  '            App --> WS & SB & NL & ED & SP & ST & CP',
  '            ED --> IN & AIP',
  '        end',
  '',
  '        subgraph RB["Rust Backend"]',
  '            LIB["lib.rs → Tauri commands"]',
  '            VAULT["vault/"]',
  '            FM["frontmatter/"]',
  '            GIT["git/\\n(commit, sync, clone)"]',
  '            SETTINGS["settings.rs"]',
  '            SEARCH["search.rs"]',
  '            CLI["ai_agents.rs\\n+ claude_cli.rs"]',
  '        end',
  '',
  '        subgraph EXT["External Services"]',
  '            CCLI["Claude / Codex / OpenCode / Pi CLI\\n(agent subprocesses)"]',
  '            MCP["MCP Server\\n(ws://9710, 9711)"]',
  '            GCLI["git CLI\\n(system executable)"]',
  '            REMOTE["Git remotes\\n(GitHub/GitLab/Gitea/etc.)"]',
  '        end',
  '',
  '        FE -->|"Tauri IPC"| RB',
  '        CLI -->|"spawn subprocess"| CCLI',
  '        LIB -->|"register / monitor"| MCP',
  '        GIT -->|"clone / fetch / push / pull"| GCLI',
  '        GCLI -->|"network auth via user config"| REMOTE',
  '    end',
  '',
  '    style FE fill:#e8f4fd,stroke:#2196f3,color:#000',
  '    style RB fill:#fff8e1,stroke:#ff9800,color:#000',
  '    style EXT fill:#f3e5f5,stroke:#9c27b0,color:#000',
  '```',
].join('\n')
const INVALID_DIAGRAM = [
  '```mermaid',
  'not a diagram',
  '```',
].join('\n')

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(90_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVault(page, tempVaultDir)
})

test.afterEach(async () => {
  removeFixtureVaultCopy(tempVaultDir)
})

async function openNote(page: Page, title: string): Promise<void> {
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
}

async function toggleRawMode(page: Page, visibleSelector: '.bn-editor' | '.cm-content'): Promise<void> {
  await openCommandPalette(page)
  await executeCommand(page, 'Toggle Raw')
  await expect(page.locator(visibleSelector)).toBeVisible({ timeout: 5_000 })
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

    const host = document.querySelector('.cm-content') as CodeMirrorHost | null
    return host?.cmTile?.view?.state.doc.toString() ?? host?.textContent ?? ''
  })
}

async function setRawEditorContent(page: Page, content: string): Promise<void> {
  await page.evaluate((nextContent) => {
    type CodeMirrorHost = Element & {
      cmTile?: {
        view?: {
          state: {
            doc: {
              length: number
            }
          }
          dispatch(update: {
            changes: {
              from: number
              to: number
              insert: string
            }
          }): void
        }
      }
    }

    const host = document.querySelector('.cm-content') as CodeMirrorHost | null
    const view = host?.cmTile?.view
    if (!view) return

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextContent },
    })
  }, content)
}

async function expectRenderedDiagramCount(page: Page, count: number): Promise<void> {
  await expect(page.locator('[data-testid="mermaid-diagram-viewport"] svg')).toHaveCount(count, { timeout: 15_000 })
}

async function countLargeBlackFilledShapes(page: Page, diagramIndex: number): Promise<number> {
  return page.locator('[data-testid="mermaid-diagram-viewport"] svg').nth(diagramIndex).evaluate((svg) => {
    const shapes = Array.from(svg.querySelectorAll<SVGGraphicsElement>('rect,path,polygon'))

    return shapes.filter((shape) => {
      const box = shape.getBoundingClientRect()
      return getComputedStyle(shape).fill === 'rgb(0, 0, 0)'
        && box.width > 12
        && box.height > 8
    }).length
  })
}

function readNoteBFile(): string {
  return fs.readFileSync(path.join(tempVaultDir, 'note', 'note-b.md'), 'utf8')
}

test('Mermaid diagrams render, fall back, and round-trip through raw mode', async ({ page }) => {
  await openNote(page, 'Note B')
  await toggleRawMode(page, '.cm-content')

  const originalContent = await getRawEditorContent(page)
  const nextContent = `${originalContent.trimEnd()}

${FIRST_DIAGRAM}

${INVALID_DIAGRAM}

${SECOND_DIAGRAM}

${SYSTEM_OVERVIEW_DIAGRAM}
`

  await setRawEditorContent(page, nextContent)
  await expect.poll(readNoteBFile).toContain(FIRST_DIAGRAM)

  await toggleRawMode(page, '.bn-editor')
  await expectRenderedDiagramCount(page, 3)
  await expect.poll(() => countLargeBlackFilledShapes(page, 2)).toBe(0)
  await expect(page.locator('[data-testid="mermaid-diagram-error"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="mermaid-diagram-error"]')).toContainText('not a diagram')

  await page.locator('[data-testid="mermaid-diagram"]').nth(2).hover()
  await page.getByRole('button', { name: 'Open Mermaid diagram' }).nth(2).click()
  await expect(page.locator('[data-testid="mermaid-diagram-dialog-viewport"] svg')).toBeVisible()
  await page.keyboard.press('Escape')

  await toggleRawMode(page, '.cm-content')
  const rawAfterRichMode = await getRawEditorContent(page)
  expect(rawAfterRichMode).toContain(FIRST_DIAGRAM)
  expect(rawAfterRichMode).toContain(INVALID_DIAGRAM)
  expect(rawAfterRichMode).toContain(SECOND_DIAGRAM)
  expect(rawAfterRichMode).toContain(SYSTEM_OVERVIEW_DIAGRAM)

  await setRawEditorContent(page, rawAfterRichMode.replace(FIRST_DIAGRAM, UPDATED_FIRST_DIAGRAM))
  await expect.poll(readNoteBFile).toContain(UPDATED_FIRST_DIAGRAM)

  await toggleRawMode(page, '.bn-editor')
  await expectRenderedDiagramCount(page, 3)
  await expect(page.locator('[data-testid="mermaid-diagram-viewport"]').first()).toContainText('Published')

  await openNote(page, 'Note C')
  await openNote(page, 'Note B')
  await toggleRawMode(page, '.cm-content')

  const reopenedRaw = await getRawEditorContent(page)
  expect(reopenedRaw).toContain(UPDATED_FIRST_DIAGRAM)
  expect(reopenedRaw).toContain(INVALID_DIAGRAM)
  expect(reopenedRaw).toContain(SECOND_DIAGRAM)
  expect(reopenedRaw).toContain(SYSTEM_OVERVIEW_DIAGRAM)
})
