import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import {
  compileVaultExpressionTemplate,
  renderVaultExpressionTemplate,
  vaultExpressionDependencySource,
} from './vaultExpressions'

function entry(path: string, title: string): VaultEntry {
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
})
