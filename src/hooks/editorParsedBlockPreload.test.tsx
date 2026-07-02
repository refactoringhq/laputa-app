import { renderHook, act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import type { VaultEntry } from '../types'
import { cacheNoteContent, clearPrefetchCache } from './useTabManagement'
import {
  PARSED_BLOCK_PRELOAD_DELAY_MS,
  PARSED_BLOCK_PRELOAD_FOREGROUND_IDLE_MS,
  PARSED_BLOCK_PRELOAD_MIN_BYTES,
  useParsedBlockPreload,
} from './editorParsedBlockPreload'
import type { NoteContentRequestOptions } from './noteContentCache'

type RefSet = {
  activeTabPathRef: MutableRefObject<string | null>
  editorMountedRef: MutableRefObject<boolean>
  foregroundWorkAtRef: MutableRefObject<number>
  rawModeRef: MutableRefObject<boolean>
}

function makeEntry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    path: '/vault/large.md',
    filename: 'large.md',
    title: 'Large',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: 'Active',
    archived: false,
    modifiedAt: 1_700_000_000,
    createdAt: 1_700_000_000,
    fileSize: PARSED_BLOCK_PRELOAD_MIN_BYTES + 1,
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

function makeRefs(overrides: Partial<{
  activeTabPath: string | null
  editorMounted: boolean
  foregroundWorkAt: number
  rawMode: boolean
}> = {}): RefSet {
  return {
    activeTabPathRef: { current: overrides.activeTabPath ?? '/vault/open.md' },
    editorMountedRef: { current: overrides.editorMounted ?? true },
    foregroundWorkAtRef: { current: overrides.foregroundWorkAt ?? 0 },
    rawModeRef: { current: overrides.rawMode ?? false },
  }
}

function renderParsedPreload(refs: RefSet, prepareParsedBlocks: (event: {
  entry: VaultEntry | null
  path: string
  content: string
}) => Promise<void>) {
  return renderHook(() => useParsedBlockPreload({
    ...refs,
    prepareParsedBlocks,
  }))
}

async function emitResolvedContent(
  entry: VaultEntry,
  content = '# Large\n\nBody',
  options?: NoteContentRequestOptions,
): Promise<void> {
  await act(async () => {
    cacheNoteContent(entry.path, content, entry, options)
    await vi.advanceTimersByTimeAsync(PARSED_BLOCK_PRELOAD_DELAY_MS)
  })
}

describe('useParsedBlockPreload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'))
    clearPrefetchCache()
  })

  afterEach(() => {
    cleanup()
    clearPrefetchCache()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('prepares warmed large markdown notes after the foreground editor is idle', async () => {
    const refs = makeRefs()
    const prepareParsedBlocks = vi.fn(async () => {})
    const entry = makeEntry()

    renderParsedPreload(refs, prepareParsedBlocks)
    await emitResolvedContent(entry, '# Large\n\nPrepared body.')

    expect(prepareParsedBlocks).toHaveBeenCalledWith(expect.objectContaining({
      content: '# Large\n\nPrepared body.',
      path: entry.path,
    }))
  })

  it('skips raw prefetches that are not parsed-block warmup candidates', async () => {
    const refs = makeRefs()
    const prepareParsedBlocks = vi.fn(async () => {})
    const entry = makeEntry({ path: '/vault/raw-only.md' })

    renderParsedPreload(refs, prepareParsedBlocks)
    await emitResolvedContent(entry, '# Raw only\n\nPrepared body.', { parsedBlockPreload: false })

    expect(prepareParsedBlocks).not.toHaveBeenCalled()
  })

  it('skips entries that should not compete with the foreground editor', async () => {
    const activeEntry = makeEntry({ path: '/vault/active.md' })
    const refs = makeRefs({ activeTabPath: activeEntry.path })
    const prepareParsedBlocks = vi.fn(async () => {})
    renderParsedPreload(refs, prepareParsedBlocks)

    await emitResolvedContent(activeEntry)
    await emitResolvedContent(makeEntry({ path: '/vault/small.md', fileSize: PARSED_BLOCK_PRELOAD_MIN_BYTES - 1 }))
    await emitResolvedContent(makeEntry({ path: '/vault/file.bin', fileKind: 'binary' }))

    expect(prepareParsedBlocks).not.toHaveBeenCalled()
  })

  it('drops a candidate that becomes active before the idle preparse starts', async () => {
    const entry = makeEntry({ path: '/vault/soon-active.md' })
    const refs = makeRefs()
    const prepareParsedBlocks = vi.fn(async () => {})

    renderParsedPreload(refs, prepareParsedBlocks)
    cacheNoteContent(entry.path, '# Soon Active\n\nBody', entry)
    refs.activeTabPathRef.current = entry.path
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PARSED_BLOCK_PRELOAD_DELAY_MS)
    })

    expect(prepareParsedBlocks).not.toHaveBeenCalled()
  })

  it('defers warm parsing while foreground editor work is still recent', async () => {
    const entry = makeEntry({ path: '/vault/deferred.md' })
    const refs = makeRefs({ foregroundWorkAt: Date.now() })
    const prepareParsedBlocks = vi.fn(async () => {})

    renderParsedPreload(refs, prepareParsedBlocks)
    cacheNoteContent(entry.path, '# Deferred\n\nBody', entry)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PARSED_BLOCK_PRELOAD_DELAY_MS - 50)
      refs.foregroundWorkAtRef.current = Date.now()
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(prepareParsedBlocks).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PARSED_BLOCK_PRELOAD_FOREGROUND_IDLE_MS + PARSED_BLOCK_PRELOAD_DELAY_MS)
    })
    expect(prepareParsedBlocks).toHaveBeenCalledWith(expect.objectContaining({ path: entry.path }))
  })
})
