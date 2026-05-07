import { describe, expect, it } from 'vitest'
import type { ImportNoteFromUrlResult, VaultEntry } from '../types'
import { formatUrlImportToast, noteTypeForUrlImport } from './urlImport'

function entry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/imported.md',
    filename: 'imported.md',
    title: 'Imported',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: null,
    createdAt: null,
    fileSize: 0,
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
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

function result(overrides: Partial<ImportNoteFromUrlResult> = {}): ImportNoteFromUrlResult {
  return {
    entry: entry(),
    content: '# Imported\n',
    savedMediaCount: 0,
    skippedMediaCount: 0,
    warnings: [],
    ...overrides,
  }
}

describe('urlImport utilities', () => {
  it('inherits the selected Type section for URL imports', () => {
    expect(noteTypeForUrlImport({ kind: 'sectionGroup', type: 'Project' })).toBe('Project')
  })

  it('defaults URL imports to Note outside a Type section', () => {
    expect(noteTypeForUrlImport({ kind: 'filter', filter: 'all' })).toBe('Note')
    expect(noteTypeForUrlImport({ kind: 'folder', path: 'articles' })).toBe('Note')
  })

  it('summarizes saved and skipped media without exposing the source URL', () => {
    expect(formatUrlImportToast(result({
      savedMediaCount: 1,
      skippedMediaCount: 2,
    }))).toBe('Imported "Imported" with 1 attachment; skipped 2 media items')
  })
})
