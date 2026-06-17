import { describe, it, expect } from 'vitest'
import {
  sanitizeSubfolderPath,
  resolveTypeSubfolder,
  effectiveImmediateFolder,
} from './typeSubfolder'
import type { VaultEntry } from '../types'

const makeType = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/journal.md',
  filename: 'journal.md',
  title: 'Journal',
  isA: 'Type',
  aliases: [], belongsTo: [], relatedTo: [], status: null, archived: false,
  modifiedAt: null, createdAt: null, fileSize: 0, snippet: '', wordCount: 0,
  relationships: {}, icon: null, color: null, order: null, sidebarLabel: null,
  template: null, filenameTemplate: null, sort: null, view: null, visible: null,
  properties: {}, organized: false, favorite: false, favoriteIndex: null,
  listPropertiesDisplay: [], outgoingLinks: [], hasH1: false,
  ...overrides,
})

describe('sanitizeSubfolderPath', () => {
  it('returns null for empty or whitespace-only input', () => {
    expect(sanitizeSubfolderPath('')).toBeNull()
    expect(sanitizeSubfolderPath('   ')).toBeNull()
    expect(sanitizeSubfolderPath('///')).toBeNull()
  })

  it('preserves a simple relative folder', () => {
    expect(sanitizeSubfolderPath('journals/2026/06')).toBe('journals/2026/06')
  })

  it('drops parent-directory segments so the path cannot escape the vault', () => {
    expect(sanitizeSubfolderPath('../journals')).toBe('journals')
    expect(sanitizeSubfolderPath('a/../b')).toBe('a/b')
    expect(sanitizeSubfolderPath('../../etc')).toBe('etc')
  })

  it('drops single-dot and empty segments and collapses repeated separators', () => {
    expect(sanitizeSubfolderPath('journals//2026')).toBe('journals/2026')
    expect(sanitizeSubfolderPath('a/./b')).toBe('a/b')
    expect(sanitizeSubfolderPath('/journals/')).toBe('journals')
  })

  it('strips characters that are illegal in cross-platform folder names', () => {
    expect(sanitizeSubfolderPath('a:b<c>|d?e*f\\g')).toBe('abcdefg')
    expect(sanitizeSubfolderPath('a\x00\x1fb')).toBe('ab')
    expect(sanitizeSubfolderPath('a\\b')).toBe('ab')
  })

  it('drops segments that become empty after illegal-char stripping', () => {
    expect(sanitizeSubfolderPath('foo/<>/bar')).toBe('foo/bar')
    expect(sanitizeSubfolderPath('<>')).toBeNull()
  })
})

describe('resolveTypeSubfolder', () => {
  const ctx = { type: 'Journal', now: new Date('2026-06-07T00:00:00') }

  it('returns null when the type entry is undefined', () => {
    expect(resolveTypeSubfolder(undefined, ctx)).toBeNull()
  })

  it('returns null when no subfolder template is set', () => {
    expect(resolveTypeSubfolder(makeType(), ctx)).toBeNull()
  })

  it('resolves date tokens into nested folder segments', () => {
    const typeEntry = makeType({ subfolderPath: 'journals/{{date:yyyy}}/{{date:MM}}' })
    expect(resolveTypeSubfolder(typeEntry, ctx)).toBe('journals/2026/06')
  })

  it('resolves the {{type}} token', () => {
    const typeEntry = makeType({ subfolderPath: 'inbox/{{type}}' })
    expect(resolveTypeSubfolder(typeEntry, ctx)).toBe('inbox/Journal')
  })

  it('returns null when the resolved template is empty', () => {
    const typeEntry = makeType({ subfolderPath: '   ' })
    expect(resolveTypeSubfolder(typeEntry, ctx)).toBeNull()
  })

  it('strips parent-directory escape attempts from a crafted template', () => {
    const typeEntry = makeType({ subfolderPath: '../{{date:yyyy}}' })
    expect(resolveTypeSubfolder(typeEntry, ctx)).toBe('2026')
  })
})

describe('effectiveImmediateFolder', () => {
  it('uses the type subfolder when no explicit folder is given', () => {
    expect(effectiveImmediateFolder(undefined, 'journals/2026/06')).toBe('journals/2026/06')
  })

  it('prefers an explicit folder over the type subfolder', () => {
    expect(effectiveImmediateFolder('projects/active', 'journals/2026/06')).toBe('projects/active')
  })

  it('treats an explicit empty string as an intentional root override', () => {
    expect(effectiveImmediateFolder('', 'journals/2026/06')).toBe('')
  })

  it('returns undefined when neither explicit folder nor subfolder is present', () => {
    expect(effectiveImmediateFolder(undefined, null)).toBeUndefined()
  })
})
