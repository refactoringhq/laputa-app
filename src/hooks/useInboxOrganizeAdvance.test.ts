import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useInboxOrganizeAdvance } from './useInboxOrganizeAdvance'
import type { SidebarSelection, VaultEntry } from '../types'

function makeEntry(path: string, organized = false): VaultEntry {
  const filename = path.split('/').pop() ?? path
  return {
    aliases: [],
    archived: false,
    belongsTo: [],
    color: null,
    createdAt: null,
    favorite: false,
    favoriteIndex: null,
    fileSize: 0,
    filename,
    hasH1: true,
    icon: null,
    isA: 'Note',
    listPropertiesDisplay: [],
    modifiedAt: null,
    order: null,
    organized,
    outgoingLinks: [],
    path,
    properties: {},
    relatedTo: [],
    relationships: {},
    sidebarLabel: null,
    snippet: '',
    sort: null,
    status: null,
    template: null,
    title: filename.replace(/\.md$/, ''),
    view: null,
    visible: null,
    wordCount: 0,
  }
}

function renderInboxAdvance(options: {
  activePath?: string | null
  autoAdvanceEnabled?: boolean
  entries?: VaultEntry[]
  onSelectNote?: (entry: VaultEntry) => void | Promise<void>
  onToggleOrganized?: (path: string) => Promise<boolean>
  selection?: SidebarSelection
  visibleEntries?: VaultEntry[]
}) {
  const entries = options.entries ?? [
    makeEntry('/vault/first.md'),
    makeEntry('/vault/second.md'),
  ]
  const activePath = options.activePath ?? entries[0]?.path ?? null

  return renderHook(() => {
    const activeTabPathRef = useRef<string | null>(activePath)
    const requestedActiveTabPathRef = useRef<string | null>(activePath)
    const visibleNotesRef = useRef<VaultEntry[]>(options.visibleEntries ?? entries)

    return {
      organize: useInboxOrganizeAdvance({
        activeTabPath: activePath,
        activeTabPathRef,
        autoAdvanceEnabled: options.autoAdvanceEnabled ?? true,
        entries,
        onSelectNote: options.onSelectNote ?? vi.fn(),
        onToggleOrganized: options.onToggleOrganized ?? vi.fn().mockResolvedValue(true),
        requestedActiveTabPathRef,
        selection: options.selection ?? { kind: 'filter', filter: 'inbox' },
        visibleNotesRef,
      }),
      requestedActiveTabPathRef,
    }
  })
}

describe('useInboxOrganizeAdvance', () => {
  it('opens the next visible inbox note after organizing the active note', async () => {
    const entries = [makeEntry('/vault/first.md'), makeEntry('/vault/second.md')]
    const onSelectNote = vi.fn()
    const { result } = renderInboxAdvance({ entries, onSelectNote })

    await act(async () => {
      await result.current.organize('/vault/first.md')
    })

    expect(onSelectNote).toHaveBeenCalledWith(entries[1])
  })

  it('does not advance when focus changed during organization', async () => {
    const entries = [makeEntry('/vault/first.md'), makeEntry('/vault/second.md')]
    const onSelectNote = vi.fn()
    const hook = renderInboxAdvance({
      entries,
      onSelectNote,
      onToggleOrganized: async () => {
        hook.result.current.requestedActiveTabPathRef.current = '/vault/other.md'
        return true
      },
    })

    await act(async () => {
      await hook.result.current.organize('/vault/first.md')
    })

    expect(onSelectNote).not.toHaveBeenCalled()
  })
})
