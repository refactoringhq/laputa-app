import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import {
  compileVaultExpressionTemplate,
  renderVaultExpressionTemplate,
  vaultExpressionDependencySource,
} from './vaultExpressions'

const refactoringWorkspace = {
  alias: 'refactoring-vault',
  available: true,
  color: null,
  defaultForNewNotes: true,
  icon: null,
  id: 'refactoring-vault',
  label: 'Refactoring Vault',
  mounted: true,
  path: '/vault',
  shortLabel: 'RV',
}

function entry(path: string, title: string, overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    aliases: [],
    archived: false,
    belongsTo: [],
    color: null,
    createdAt: null,
    display: null,
    favorite: false,
    favoriteIndex: null,
    fileKind: 'markdown',
    fileSize: 0,
    filename: path.split('/').at(-1) ?? path,
    hasH1: true,
    icon: null,
    isA: null,
    listPropertiesDisplay: [],
    modifiedAt: null,
    noteWidth: null,
    order: null,
    organized: true,
    outgoingLinks: [],
    path,
    properties: {},
    relationships: {},
    relatedTo: [],
    sidebarLabel: null,
    snippet: '',
    sort: null,
    status: null,
    template: null,
    title,
    view: null,
    visible: null,
    wordCount: 0,
    ...overrides,
  }
}

describe('vaultExpressions', () => {
  it('renders current-note properties with escaped text interpolation and formatting functions', () => {
    const sourceEntry = entry('/vault/current.md', 'Current Note')
    const rendered = renderVaultExpressionTemplate({
      compiled: compileVaultExpressionTemplate([
        '<h1>{{title}}</h1>',
        '<p>{{upper(status)}} {{formatCurrency(amount, "USD", 1)}}</p>',
        '<p>{{first_name + " " + last_name}}</p>',
        '<p>{{summary}}</p>',
      ].join('')),
      context: {
        contentsByPath: new Map(),
        currentContent: [
          '---',
          'status: active',
          'amount: 1234.5',
          'first_name: Ada',
          'last_name: Lovelace',
          'summary: <strong>unsafe</strong>',
          '---',
          '# Current Note',
        ].join('\n'),
        entries: [sourceEntry],
        locale: 'en-US',
        sourceEntry,
      },
    })

    expect(rendered.html).toContain('<h1>Current Note</h1>')
    expect(rendered.html).toContain('<p>ACTIVE $1,234.5</p>')
    expect(rendered.html).toContain('<p>Ada Lovelace</p>')
    expect(rendered.html).toContain('&lt;strong&gt;unsafe&lt;/strong&gt;')
  })

  it('renders external note properties, line references, and fallback values', () => {
    const sourceEntry = entry('/vault/current.md', 'Current Note')
    const briefEntry = entry('/vault/brief.md', 'Brief')
    const rendered = renderVaultExpressionTemplate({
      compiled: compileVaultExpressionTemplate([
        '<p>{{[[brief]].status}}</p>',
        '<p>{{[[brief]].2}}</p>',
        '<p>{{default([[brief]].missing, "Fallback")}}</p>',
      ].join('')),
      context: {
        contentsByPath: new Map([
          [briefEntry.path, [
            '---',
            'status: Draft',
            '---',
            '# Brief',
            'Budget: 1200, expected',
          ].join('\n')],
        ]),
        currentContent: '# Current Note',
        entries: [sourceEntry, briefEntry],
        locale: 'en-US',
        sourceEntry,
      },
    })

    expect(rendered.html).toBe('<p>Draft</p><p>Budget: 1200, expected</p><p>Fallback</p>')
  })

  it('preserves unresolved expressions as visible escaped placeholders', () => {
    const sourceEntry = entry('/vault/current.md', 'Current Note')
    const rendered = renderVaultExpressionTemplate({
      compiled: compileVaultExpressionTemplate('<p>{{missing}}</p><p>{{[[unknown]].status}}</p>'),
      context: {
        contentsByPath: new Map(),
        currentContent: '# Current Note',
        entries: [sourceEntry],
        locale: 'en-US',
        sourceEntry,
      },
    })

    expect(rendered.html).toBe('<p>{{missing}}</p><p>{{[[unknown]].status}}</p>')
    expect(rendered.unresolved).toEqual(['missing', '[[unknown]].status'])
  })

  it('emits formula-compatible dependency source for external references', () => {
    const compiled = compileVaultExpressionTemplate([
      '{{[[brief]].status}}',
      '{{[[brief]].2}}',
      '{{[[budget]].B12}}',
      '{{status}}',
    ].join(''))

    expect(vaultExpressionDependencySource(compiled)).toBe([
      '=[[brief]].status',
      '=[[brief]].2',
      '=[[budget]].B12',
    ].join('\n'))
  })

  it('serializes enriched relationship JSON from normalized relationship keys', () => {
    const sourceEntry = entry('/vault/dashboard.md', 'Dashboard', { workspace: refactoringWorkspace })
    const essayEntry = entry('/vault/acceleration-whiplash.md', 'Acceleration whiplash', {
      relationships: {
        'Has Notes': [
          '[[starting-work-is-easier-finishing-it-is-harder|Starting work is easier, finishing it is harder]]',
          '[[human-reviews-do-not-scale-like-ai-coding]]',
        ],
      },
      status: 'Evergreened',
      workspace: refactoringWorkspace,
    })
    const firstNote = entry('/vault/starting-work-is-easier-finishing-it-is-harder.md', 'Ignored when alias exists', {
      status: 'Extracted',
      workspace: refactoringWorkspace,
    })
    const secondNote = entry('/vault/human-reviews-do-not-scale-like-ai-coding.md', 'Human reviews do not scale like AI coding', {
      status: 'Evergreen',
      workspace: refactoringWorkspace,
    })

    const rendered = renderVaultExpressionTemplate({
      compiled: compileVaultExpressionTemplate([
        '<script type="application/json" id="essay">{{json("[[acceleration-whiplash]]")}}</script>',
        '<script type="application/json" id="notes">{{json([[acceleration-whiplash]].has_notes)}}</script>',
      ].join('')),
      context: {
        contentsByPath: new Map(),
        currentContent: '# Dashboard',
        entries: [sourceEntry, essayEntry, firstNote, secondNote],
        locale: 'en-US',
        sourceEntry,
        vaultPath: '/vault',
      },
    })

    const parser = new DOMParser()
    const documentObject = parser.parseFromString(rendered.html, 'text/html')
    const essay = JSON.parse(documentObject.getElementById('essay')?.textContent ?? 'null') as Record<string, unknown>
    const notes = JSON.parse(documentObject.getElementById('notes')?.textContent ?? '[]') as Array<Record<string, unknown>>

    expect(essay).toMatchObject({
      deepLink: 'tolaria://refactoring-vault/acceleration-whiplash.md',
      path: '/vault/acceleration-whiplash.md',
      status: 'Evergreened',
      target: 'acceleration-whiplash',
      title: 'Acceleration whiplash',
    })
    expect(notes).toHaveLength(2)
    expect(notes[0]).toMatchObject({
      deepLink: 'tolaria://refactoring-vault/starting-work-is-easier-finishing-it-is-harder.md',
      path: '/vault/starting-work-is-easier-finishing-it-is-harder.md',
      status: 'Extracted',
      title: 'Starting work is easier, finishing it is harder',
    })
    expect(notes[1]).toMatchObject({
      deepLink: 'tolaria://refactoring-vault/human-reviews-do-not-scale-like-ai-coding.md',
      path: '/vault/human-reviews-do-not-scale-like-ai-coding.md',
      status: 'Evergreen',
      title: 'Human reviews do not scale like AI coding',
    })
    expect(rendered.unresolved).toEqual([])
  })

  it('reuses deep-link vault context while serializing many relationship JSON links', () => {
    let workspaceReads = 0
    const countedEntry = (path: string, title: string, overrides: Partial<VaultEntry> = {}) => {
      const value = entry(path, title, overrides)
      Object.defineProperty(value, 'workspace', {
        configurable: true,
        enumerable: true,
        get: () => {
          workspaceReads += 1
          return refactoringWorkspace
        },
      })
      return value
    }
    const linkedTargets = Array.from({ length: 24 }, (_value, index) => `related-${index + 1}`)
    const sourceEntry = countedEntry('/vault/dashboard.md', 'Dashboard')
    const hubEntry = countedEntry('/vault/hub.md', 'Hub', {
      relationships: {
        'Has Notes': linkedTargets.map((target) => `[[${target}]]`),
      },
    })
    const linkedEntries = linkedTargets.map((target, index) => (
      countedEntry(`/vault/${target}.md`, `Related ${index + 1}`, { status: 'Active' })
    ))
    const fillerEntries = Array.from({ length: 12 }, (_value, index) => (
      countedEntry(`/vault/filler-${index + 1}.md`, `Filler ${index + 1}`)
    ))
    const entries = [sourceEntry, hubEntry, ...linkedEntries, ...fillerEntries]

    const rendered = renderVaultExpressionTemplate({
      compiled: compileVaultExpressionTemplate('<script type="application/json">{{json([[hub]].has_notes)}}</script>'),
      context: {
        contentsByPath: new Map(),
        currentContent: '# Dashboard',
        entries,
        locale: 'en-US',
        sourceEntry,
        vaultPath: '/vault',
      },
    })

    const parser = new DOMParser()
    const documentObject = parser.parseFromString(rendered.html, 'text/html')
    const notes = JSON.parse(documentObject.querySelector('script')?.textContent ?? '[]') as Array<Record<string, unknown>>

    expect(notes).toHaveLength(linkedTargets.length)
    expect(notes[23]).toMatchObject({
      deepLink: 'tolaria://refactoring-vault/related-24.md',
      title: 'Related 24',
    })
    expect(workspaceReads).toBeLessThanOrEqual(entries.length * 5)
  })

  it('escapes JSON so dynamic data cannot close the script element', () => {
    const sourceEntry = entry('/vault/dashboard.md', 'Dashboard', { workspace: refactoringWorkspace })
    const unsafeNote = entry('/vault/unsafe.md', '</script><img src=x onerror=alert(1)>', {
      workspace: refactoringWorkspace,
    })

    const rendered = renderVaultExpressionTemplate({
      compiled: compileVaultExpressionTemplate('<script type="application/json">{{json("[[unsafe]]")}}</script>'),
      context: {
        contentsByPath: new Map(),
        currentContent: '# Dashboard',
        entries: [sourceEntry, unsafeNote],
        locale: 'en-US',
        sourceEntry,
        vaultPath: '/vault',
      },
    })

    expect(rendered.html).not.toContain('</script><img')
    expect(rendered.html).toContain('\\u003c/script\\u003e')
    expect(rendered.html).toContain('\\u003cimg')
  })
})
