import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { shouldReplaceSyncedTabEntry } from './tabEntrySync'

const baseEntry: VaultEntry = {
  path: '/vault/notes/alpha.md',
  filename: 'alpha.md',
  title: 'Alpha',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  modifiedAt: 1700000000,
  createdAt: 1699999999,
  fileSize: 128,
  snippet: 'Alpha note',
  wordCount: 2,
  relationships: {},
  outgoingLinks: [],
  archived: false,
  trashed: false,
  trashedAt: null,
  properties: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: true,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: true,
  fileKind: 'markdown',
}

describe('shouldReplaceSyncedTabEntry', () => {
  it('skips rebuilt entries with equivalent metadata', () => {
    expect(shouldReplaceSyncedTabEntry(baseEntry, { ...baseEntry })).toBe(false)
  })

  it('treats omitted and undefined workspace metadata as equivalent', () => {
    const rebuiltEntry = { ...baseEntry, workspace: undefined }

    expect(shouldReplaceSyncedTabEntry(baseEntry, rebuiltEntry)).toBe(false)
  })

  it('replaces the tab entry when visible metadata changes', () => {
    expect(shouldReplaceSyncedTabEntry(baseEntry, { ...baseEntry, title: 'Renamed Alpha' })).toBe(true)
  })
})
