import { expect, test, type Locator, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { executeCommand, openCommandPalette } from './helpers'
import { RUNTIME_STYLE_NONCE } from '../../src/lib/runtimeStyleNonce'

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
const REPORTED_THEME_DIAGRAM = [
  '```mermaid',
  "%%{init: {'theme':'base','themeVariables':{'primaryColor':'#dbe7ff','primaryTextColor':'#0b1220','primaryBorderColor':'#1f3a8a','lineColor':'#1f3a8a','secondaryColor':'#fff4d6','tertiaryColor':'#ffe0e0','fontSize':'14px'}}}%%",
  'flowchart TD',
  '    A(["Employee clocks in"]) --> B{"Linked to a planned shift?"}',
  '',
  '    B -- "Yes" --> C["Other path<br/>for scheduled shift"]',
  '    C --> D["Contract path<br/>for scheduled shift"]',
  '',
  '    B -- "No (unscheduled)" --> E["other path<br/>for unscheduled clocking"]',
  '',
  '    classDef path fill:#fff4d6,stroke:#7a5b00,stroke-width:2px,color:#3a2c00;',
  '    class C,D,E,F path;',
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
  fs.writeFileSync(
    path.join(tempVaultDir, 'note', 'mermaid-reported.md'),
    [
      '# Mermaid Reported',
      '',
      REPORTED_THEME_DIAGRAM,
      '',
    ].join('\n'),
  )
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

function mermaidSvg(page: Page, diagramIndex: number): Locator {
  return page.locator('[data-testid="mermaid-diagram-viewport"] svg').nth(diagramIndex)
}

function mermaidNode(page: Page, diagramIndex: number, text: string): Locator {
  return mermaidSvg(page, diagramIndex).locator('.node').filter({ hasText: text }).first()
}

async function computedCss(locator: Locator, property: 'color' | 'fill' | 'stroke'): Promise<string> {
  return locator.evaluate((element, styleProperty) => (
    getComputedStyle(element).getPropertyValue(styleProperty)
  ), property)
}

async function readStyleNonce(svg: Locator): Promise<string | null> {
  return svg.locator('style').first().evaluate((style) => {
    const nonce = (style as HTMLElement).nonce
    return nonce.length > 0 ? nonce : style.getAttribute('nonce')
  })
}

async function labelFitsNode(node: Locator): Promise<boolean> {
  return node.evaluate((element) => {
    const shape = element.querySelector<SVGGraphicsElement>('rect, polygon, circle, ellipse, path')!
    const label = element.querySelector<HTMLElement>('.nodeLabel')!
    const shapeBox = shape.getBoundingClientRect()
    const labelBox = label.getBoundingClientRect()
    return [
      labelBox.width <= shapeBox.width + 2,
      labelBox.height <= shapeBox.height + 2,
    ].every(Boolean)
  })
}

async function readReportedDiagramMetrics(page: Page, diagramIndex: number) {
  const svg = mermaidSvg(page, diagramIndex)
  const scheduledNode = mermaidNode(page, diagramIndex, 'Other path')
  const scheduledShape = scheduledNode.locator('rect, polygon, circle, ellipse, path').first()
  const scheduledLabel = scheduledNode.locator('.nodeLabel').first()

  return {
    connectorStroke: await computedCss(svg.locator('.flowchart-link').first(), 'stroke'),
    markerFill: await computedCss(svg.locator('marker path').first(), 'fill'),
    scheduledFill: await computedCss(scheduledShape, 'fill'),
    scheduledStroke: await computedCss(scheduledShape, 'stroke'),
    scheduledTextColor: await computedCss(scheduledLabel, 'color'),
    labelsFit: [
      await labelFitsNode(scheduledNode),
      await labelFitsNode(mermaidNode(page, diagramIndex, 'Contract path')),
      await labelFitsNode(mermaidNode(page, diagramIndex, 'unscheduled clocking')),
    ].every(Boolean),
    styleNonce: await readStyleNonce(svg),
    text: await svg.evaluate((element) => element.textContent ?? ''),
  }
}

function readNoteBFile(): string {
  return fs.readFileSync(path.join(tempVaultDir, 'note', 'note-b.md'), 'utf8')
}

test('Mermaid diagrams render when opening saved notes directly', async ({ page }) => {
  await openNote(page, 'Mermaid Reported')
  await expectRenderedDiagramCount(page, 1)
  await expect.poll(() => readReportedDiagramMetrics(page, 0)).toMatchObject({
    connectorStroke: 'rgb(31, 58, 138)',
    markerFill: 'rgb(31, 58, 138)',
    scheduledFill: 'rgb(255, 244, 214)',
    scheduledStroke: 'rgb(122, 91, 0)',
    scheduledTextColor: 'rgb(58, 44, 0)',
    labelsFit: true,
    styleNonce: RUNTIME_STYLE_NONCE,
    text: expect.stringContaining('Linked to a planned shift?'),
  })
})

test('Mermaid diagrams render, fall back, and round-trip through raw mode', async ({ page }) => {
  await openNote(page, 'Note B')
  await toggleRawMode(page, '.cm-content')

  const originalContent = await getRawEditorContent(page)
  const nextContent = `${originalContent.trimEnd()}

${FIRST_DIAGRAM}

${REPORTED_THEME_DIAGRAM}

${INVALID_DIAGRAM}

${SECOND_DIAGRAM}

${SYSTEM_OVERVIEW_DIAGRAM}
`

  await setRawEditorContent(page, nextContent)
  await expect.poll(readNoteBFile).toContain(FIRST_DIAGRAM)

  await toggleRawMode(page, '.bn-editor')
  await expectRenderedDiagramCount(page, 4)
  await expect.poll(() => countLargeBlackFilledShapes(page, 3)).toBe(0)
  await expect.poll(() => readReportedDiagramMetrics(page, 1)).toMatchObject({
    connectorStroke: 'rgb(31, 58, 138)',
    markerFill: 'rgb(31, 58, 138)',
    scheduledFill: 'rgb(255, 244, 214)',
    scheduledStroke: 'rgb(122, 91, 0)',
    scheduledTextColor: 'rgb(58, 44, 0)',
    labelsFit: true,
    styleNonce: RUNTIME_STYLE_NONCE,
    text: expect.stringContaining('Linked to a planned shift?'),
  })
  await expect(page.locator('[data-testid="mermaid-diagram-error"]')).toHaveCount(1)
  await expect(page.locator('[data-testid="mermaid-diagram-error"]')).toContainText('not a diagram')

  await page.locator('[data-testid="mermaid-diagram"]').nth(3).hover()
  await page.getByRole('button', { name: 'Open Mermaid diagram' }).nth(3).click()
  await expect(page.locator('[data-testid="mermaid-diagram-dialog-viewport"] svg')).toBeVisible()
  await page.keyboard.press('Escape')

  await toggleRawMode(page, '.cm-content')
  const rawAfterRichMode = await getRawEditorContent(page)
  expect(rawAfterRichMode).toContain(FIRST_DIAGRAM)
  expect(rawAfterRichMode).toContain(REPORTED_THEME_DIAGRAM)
  expect(rawAfterRichMode).toContain(INVALID_DIAGRAM)
  expect(rawAfterRichMode).toContain(SECOND_DIAGRAM)
  expect(rawAfterRichMode).toContain(SYSTEM_OVERVIEW_DIAGRAM)

  await setRawEditorContent(page, rawAfterRichMode.replace(FIRST_DIAGRAM, UPDATED_FIRST_DIAGRAM))
  await expect.poll(readNoteBFile).toContain(UPDATED_FIRST_DIAGRAM)

  await toggleRawMode(page, '.bn-editor')
  await expectRenderedDiagramCount(page, 4)
  await expect(page.locator('[data-testid="mermaid-diagram-viewport"]').first()).toContainText('Published')

  await openNote(page, 'Note C')
  await openNote(page, 'Note B')
  await toggleRawMode(page, '.cm-content')

  const reopenedRaw = await getRawEditorContent(page)
  expect(reopenedRaw).toContain(UPDATED_FIRST_DIAGRAM)
  expect(reopenedRaw).toContain(REPORTED_THEME_DIAGRAM)
  expect(reopenedRaw).toContain(INVALID_DIAGRAM)
  expect(reopenedRaw).toContain(SECOND_DIAGRAM)
  expect(reopenedRaw).toContain(SYSTEM_OVERVIEW_DIAGRAM)
})
