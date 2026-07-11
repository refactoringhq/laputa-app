import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { VaultEntry } from '../types'
import {
  needsRenameOnSave,
  buildRenamedEntry,
  renameToastMessage,
  useNoteRename,
} from './useNoteRename'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
  addMockEntry: vi.fn(),
  updateMockContent: vi.fn(),
  trackMockChange: vi.fn(),
  mockInvoke: vi.fn().mockResolvedValue(''),
}))

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/vault/test.md', filename: 'test.md', title: 'Test Note', isA: 'Note',
  aliases: [], belongsTo: [], relatedTo: [], status: 'Active', archived: false,
  modifiedAt: 1700000000, createdAt: 1700000000, fileSize: 100, snippet: '',
  wordCount: 0, relationships: {}, icon: null, color: null, order: null,
  outgoingLinks: [], template: null, sort: null, sidebarLabel: null,
  view: null, visible: null, properties: {},
  ...overrides,
})

const makeWorkspace = (path: string, alias = 'workspace'): NonNullable<VaultEntry['workspace']> => ({
  id: alias,
  label: alias,
  alias,
  path,
  shortLabel: alias.slice(0, 2).toUpperCase(),
  color: null,
  icon: null,
  mounted: true,
  available: true,
  defaultForNewNotes: false,
})

describe('needsRenameOnSave', () => {
  it('returns true when filename does not match title slug', () => {
    expect(needsRenameOnSave('My New Note', 'untitled-note.md')).toBe(true)
  })

  it('returns false when filename matches title slug', () => {
    expect(needsRenameOnSave('My Note', 'my-note.md')).toBe(false)
  })

  it('returns false for untitled note with matching slug', () => {
    expect(needsRenameOnSave('Untitled note', 'untitled-note.md')).toBe(false)
  })
})

describe('buildRenamedEntry', () => {
  it('creates entry with new title and path', () => {
    const entry = makeEntry({ path: '/vault/old.md', filename: 'old.md', title: 'Old' })
    const renamed = buildRenamedEntry(entry, 'New Title', '/vault/new-title.md')
    expect(renamed.path).toBe('/vault/new-title.md')
    expect(renamed.title).toBe('New Title')
    expect(renamed.filename).toBe('new-title.md')
    expect(renamed.isA).toBe('Note')
  })

  it('preserves other entry fields', () => {
    const entry = makeEntry({ status: 'Done', aliases: ['x'] })
    const renamed = buildRenamedEntry(entry, 'Renamed', '/vault/renamed.md')
    expect(renamed.status).toBe('Done')
    expect(renamed.aliases).toEqual(['x'])
  })

  it('derives the filename from the backend path for Unicode titles', () => {
    const entry = makeEntry({ path: '/vault/old.md', filename: 'old.md', title: 'Old' })
    const renamed = buildRenamedEntry(entry, '你好', '/vault/你好.md')
    expect(renamed.path).toBe('/vault/你好.md')
    expect(renamed.filename).toBe('你好.md')
    expect(renamed.title).toBe('你好')
  })
})

describe('renameToastMessage', () => {
  it('returns "Renamed" when no files updated', () => {
    expect(renameToastMessage(0, 0)).toBe('Renamed')
  })

  it('returns singular when 1 file updated', () => {
    expect(renameToastMessage(1, 0)).toBe('Updated 1 note')
  })

  it('returns plural when multiple files updated', () => {
    expect(renameToastMessage(3, 0)).toBe('Updated 3 notes')
  })

  it('surfaces failed linked-note rewrites even when some updates succeeded', () => {
    expect(renameToastMessage(2, 1)).toBe('Updated 2 notes, but 1 linked note needs manual updates')
  })

  it('surfaces failed linked-note rewrites when none of them updated cleanly', () => {
    expect(renameToastMessage(0, 2)).toBe('Renamed, but 2 linked notes need manual updates')
  })
})

describe('useNoteRename hook', () => {
  const setToastMessage = vi.fn()
  const setTabs = vi.fn((fn: (prev: unknown[]) => unknown[]) => fn([]))
  const handleSwitchTab = vi.fn()
  const updateTabContent = vi.fn()
  const activeTabPathRef = { current: null as string | null }

  type RenameNoteResult = {
    new_path: string
    updated_files: number
    failed_updates: number
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    activeTabPathRef.current = null
  })

  const stubRenameNote = (
    renameResult: RenameNoteResult,
    content = '# New\n',
  ) => {
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note') return renameResult
      if (cmd === 'get_note_content') return content
      return ''
    })
  }

  const renderUseNoteRename = (entries: VaultEntry[] = []) =>
    renderHook(() => useNoteRename(
      { entries, setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

  const runHandleRenameNote = async ({
    path = '/vault/old.md',
    entries = [],
    renameResult = { new_path: '/vault/new.md', updated_files: 0, failed_updates: 0 },
    activePath = null,
    onEntryRenamed = vi.fn(),
  }: {
    path?: string
    entries?: VaultEntry[]
    renameResult?: RenameNoteResult
    activePath?: string | null
    onEntryRenamed?: ReturnType<typeof vi.fn>
  } = {}) => {
    activeTabPathRef.current = activePath
    stubRenameNote(renameResult)

    const { result } = renderUseNoteRename(entries)
    await act(async () => {
      await result.current.handleRenameNote(path, 'New', '/vault', onEntryRenamed)
    })

    return { onEntryRenamed }
  }

  it('handleRenameNote calls rename_note and updates toast', async () => {
    const entry = makeEntry({ path: '/vault/old.md', title: 'Old' })
    const onEntryRenamed = vi.fn()
    await runHandleRenameNote({
      entries: [entry],
      renameResult: { new_path: '/vault/new.md', updated_files: 2, failed_updates: 0 },
      onEntryRenamed,
    })

    expect(mockInvoke).toHaveBeenCalledWith('rename_note', expect.objectContaining({
      old_path: '/vault/old.md',
      new_title: 'New',
      old_title: 'Old',
    }))
    expect(setToastMessage).toHaveBeenCalledWith('Updated 2 notes')
    expect(onEntryRenamed).toHaveBeenCalled()
  })

  it.each([
    {
      name: 'title rename',
      command: 'rename_note',
      oldPath: '/team/old.md',
      filename: 'old.md',
      title: 'Old',
      newPath: '/team/new.md',
      run: async (hook: ReturnType<typeof renderUseNoteRename>['result']['current']) =>
        hook.handleRenameNote('/team/old.md', 'New', '/personal', vi.fn()),
      expected: { old_path: '/team/old.md', old_title: 'Old' },
    },
    {
      name: 'filename rename',
      command: 'rename_note_filename',
      oldPath: '/team/old-name.md',
      filename: 'old-name.md',
      title: 'Project Kickoff',
      newPath: '/team/manual-name.md',
      run: async (hook: ReturnType<typeof renderUseNoteRename>['result']['current']) =>
        hook.handleRenameFilename('/team/old-name.md', 'manual-name', '/personal', vi.fn()),
      expected: { old_path: '/team/old-name.md', new_filename_stem: 'manual-name' },
    },
  ])('uses the note workspace root for $name even when the app-level vault path differs', async ({
    command,
    oldPath,
    filename,
    title,
    newPath,
    run,
    expected,
  }) => {
    const entry = makeEntry({
      path: oldPath,
      filename,
      title,
      workspace: makeWorkspace('/team', 'team'),
    })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === command) return { new_path: newPath, updated_files: 0, failed_updates: 0 }
      if (cmd === 'get_note_content') return '# New\n'
      return ''
    })
    const { result } = renderUseNoteRename([entry])

    await act(async () => {
      await run(result.current)
    })

    expect(mockInvoke).toHaveBeenCalledWith(command, expect.objectContaining({
      vault_path: '/team',
      ...expected,
    }))
  })

  it('handleRenameNote passes null old_title when entry not found', async () => {
    await runHandleRenameNote()

    expect(mockInvoke).toHaveBeenCalledWith('rename_note', expect.objectContaining({ old_title: null }))
  })

  it('handleRenameNote shows error toast on failure', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('fail'))

    const { result } = renderHook(() => useNoteRename(
      { entries: [], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    await act(async () => {
      await result.current.handleRenameNote('/vault/old.md', 'New', '/vault', vi.fn())
    })

    expect(setToastMessage).toHaveBeenCalledWith('Failed to rename note')
  })

  it('switches active tab when renamed note is active', async () => {
    await runHandleRenameNote({
      entries: [makeEntry({ path: '/vault/old.md' })],
      activePath: '/vault/old.md',
    })

    expect(handleSwitchTab).toHaveBeenCalledWith('/vault/new.md')
  })

  it('switches active tab when macOS /tmp aliases identify the renamed note', async () => {
    await runHandleRenameNote({
      path: '/tmp/vault/old.md',
      entries: [makeEntry({ path: '/private/tmp/vault/old.md' })],
      renameResult: { new_path: '/tmp/vault/new.md', updated_files: 0, failed_updates: 0 },
      activePath: '/private/tmp/vault/old.md',
    })

    expect(handleSwitchTab).toHaveBeenCalledWith('/tmp/vault/new.md')
  })

  it('handleRenameFilename renames the file while preserving the existing title', async () => {
    const entry = makeEntry({ path: '/vault/old-name.md', filename: 'old-name.md', title: 'Project Kickoff' })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') return { new_path: '/vault/manual-name.md', updated_files: 1, failed_updates: 0 }
      if (cmd === 'get_note_content') return '# Project Kickoff\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [entry], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    const onEntryRenamed = vi.fn()
    await act(async () => {
      await result.current.handleRenameFilename('/vault/old-name.md', 'manual-name', '/vault', onEntryRenamed)
    })

    expect(mockInvoke).toHaveBeenCalledWith('rename_note_filename', expect.objectContaining({
      old_path: '/vault/old-name.md',
      new_filename_stem: 'manual-name',
    }))
    expect(onEntryRenamed).toHaveBeenCalledWith(
      '/vault/old-name.md',
      expect.objectContaining({
        path: '/vault/manual-name.md',
        filename: 'manual-name.md',
        title: 'Project Kickoff',
      }),
      '# Project Kickoff\n',
    )
    expect(setToastMessage).toHaveBeenCalledWith('Updated 1 note')
  })

  it('handleRenameFilename refreshes filename-derived fallback titles', async () => {
    const entry = makeEntry({
      path: '/vault/plan-assumptions.md',
      filename: 'plan-assumptions.md',
      title: 'Plan Assumptions',
      hasH1: false,
    })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') return { new_path: '/vault/business-plan-assumptions.md', updated_files: 0, failed_updates: 0 }
      if (cmd === 'get_note_content') return 'Body without an H1\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [entry], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    const onEntryRenamed = vi.fn()
    await act(async () => {
      await result.current.handleRenameFilename('/vault/plan-assumptions.md', 'business-plan-assumptions', '/vault', onEntryRenamed)
    })

    expect(onEntryRenamed).toHaveBeenCalledWith(
      '/vault/plan-assumptions.md',
      expect.objectContaining({
        path: '/vault/business-plan-assumptions.md',
        filename: 'business-plan-assumptions.md',
        title: 'Business Plan Assumptions',
      }),
      'Body without an H1\n',
    )
  })

  it('preserves active tab metadata when filename rename lands after a stale vault reload', async () => {
    const entry = makeEntry({ path: '/vault/untitled-1.md', filename: 'untitled-1.md', title: 'Fresh Title' })
    let tabs = [{ entry, content: '# Fresh Title\n' }]
    const setTabs = vi.fn((update: typeof tabs | ((prev: typeof tabs) => typeof tabs)) => {
      tabs = typeof update === 'function' ? update(tabs) : update
    })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'rename_note_filename') return { new_path: '/vault/fresh-title.md', updated_files: 0, failed_updates: 0 }
      if (cmd === 'get_note_content') return '# Fresh Title\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [], setToastMessage },
      { tabs, setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    const onEntryRenamed = vi.fn()
    await act(async () => {
      await result.current.handleRenameFilename('/vault/untitled-1.md', 'fresh-title', '/vault', onEntryRenamed)
    })

    expect(tabs[0].entry).toEqual(expect.objectContaining({
      path: '/vault/fresh-title.md',
      filename: 'fresh-title.md',
      title: 'Fresh Title',
      isA: 'Note',
    }))
    expect(onEntryRenamed).toHaveBeenCalledWith(
      '/vault/untitled-1.md',
      expect.objectContaining({ title: 'Fresh Title', filename: 'fresh-title.md' }),
      '# Fresh Title\n',
    )
  })

  it('warns when rename succeeds but some backlink rewrites fail', async () => {
    const entry = makeEntry({ path: '/vault/old.md', title: 'Old' })
    await runHandleRenameNote({
      entries: [entry],
      renameResult: { new_path: '/vault/new.md', updated_files: 1, failed_updates: 2 },
    })

    expect(setToastMessage).toHaveBeenCalledWith(
      'Updated 1 note, but 2 linked notes need manual updates',
    )
  })

  it('handleRenameFilename surfaces backend conflict errors', async () => {
    vi.mocked(mockInvoke).mockRejectedValueOnce(new Error('A note with that name already exists'))

    const { result } = renderHook(() => useNoteRename(
      { entries: [makeEntry({ path: '/vault/old-name.md', filename: 'old-name.md' })], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    await act(async () => {
      await result.current.handleRenameFilename('/vault/old-name.md', 'manual-name', '/vault', vi.fn())
    })

    expect(setToastMessage).toHaveBeenCalledWith('A note with that name already exists')
  })

  it('handleMoveNoteToFolder moves the note, keeps its title intact, and refreshes open backlinks', async () => {
    const entry = makeEntry({ path: '/vault/notes/project-kickoff.md', filename: 'project-kickoff.md', title: 'Project Kickoff' })
    const backlinkEntry = makeEntry({
      path: '/vault/index.md',
      filename: 'index.md',
      title: 'Index',
    })
    const reloadedBacklinkContent = '# Index\n\nMoved link: [[projects/project-kickoff]]\n'
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'move_note_to_folder') {
        return {
          new_path: '/vault/projects/project-kickoff.md',
          updated_files: 1,
          failed_updates: 0,
        }
      }
      if (cmd === 'get_note_content') {
        return args?.path === '/vault/index.md' ? reloadedBacklinkContent : '# Project Kickoff\n'
      }
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [entry, backlinkEntry], setToastMessage },
      {
        tabs: [
          { entry, content: '# Project Kickoff\n' },
          { entry: backlinkEntry, content: '# Index\n\nOld link: [[notes/project-kickoff]]\n' },
        ],
        setTabs,
        activeTabPathRef,
        handleSwitchTab,
        updateTabContent,
      },
    ))

    const onEntryRenamed = vi.fn()
    await act(async () => {
      await result.current.handleMoveNoteToFolder('/vault/notes/project-kickoff.md', 'projects', '/vault', onEntryRenamed)
    })

    expect(mockInvoke).toHaveBeenCalledWith('move_note_to_folder', expect.objectContaining({
      old_path: '/vault/notes/project-kickoff.md',
      folder_path: 'projects',
    }))
    expect(onEntryRenamed).toHaveBeenCalledWith(
      '/vault/notes/project-kickoff.md',
      expect.objectContaining({
        path: '/vault/projects/project-kickoff.md',
        filename: 'project-kickoff.md',
        title: 'Project Kickoff',
      }),
      '# Project Kickoff\n',
    )
    expect(updateTabContent).toHaveBeenCalledWith('/vault/index.md', reloadedBacklinkContent)
    expect(setToastMessage).toHaveBeenCalledWith('Moved to "projects" and updated 1 note')
  })

  it('normalizes folder move targets before sending them to the backend', async () => {
    const entry = makeEntry({ path: '/vault/notes/project-kickoff.md', filename: 'project-kickoff.md', title: 'Project Kickoff' })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'move_note_to_folder') {
        return {
          new_path: '/vault/projects/active/project-kickoff.md',
          updated_files: 0,
          failed_updates: 0,
        }
      }
      if (cmd === 'get_note_content') return '# Project Kickoff\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [entry], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    await act(async () => {
      await result.current.handleMoveNoteToFolder('/vault/notes/project-kickoff.md', String.raw`/projects\active/`, '/vault', vi.fn())
    })

    expect(mockInvoke).toHaveBeenCalledWith('move_note_to_folder', expect.objectContaining({
      folder_path: 'projects/active',
    }))
    expect(setToastMessage).toHaveBeenCalledWith('Moved to "active"')
  })

  it('handleMoveNoteToWorkspace moves the note to a different workspace', async () => {
    const sourceWorkspace = makeWorkspace('/personal', 'personal')
    const destinationWorkspace = makeWorkspace('/team', 'team')
    destinationWorkspace.label = 'Team'
    const entry = makeEntry({
      path: '/personal/notes/project-kickoff.md',
      filename: 'project-kickoff.md',
      title: 'Project Kickoff',
      workspace: sourceWorkspace,
    })
    vi.mocked(mockInvoke).mockImplementation(async (cmd: string) => {
      if (cmd === 'move_note_to_workspace') {
        return {
          new_path: '/team/notes/project-kickoff.md',
          updated_files: 1,
          failed_updates: 0,
        }
      }
      if (cmd === 'get_note_content') return '# Project Kickoff\n'
      return ''
    })

    const { result } = renderHook(() => useNoteRename(
      { entries: [entry], setToastMessage },
      { tabs: [], setTabs, activeTabPathRef, handleSwitchTab, updateTabContent },
    ))

    const onEntryRenamed = vi.fn()
    await act(async () => {
      await result.current.handleMoveNoteToWorkspace(
        '/personal/notes/project-kickoff.md',
        destinationWorkspace,
        '/personal',
        onEntryRenamed,
      )
    })

    expect(mockInvoke).toHaveBeenCalledWith('move_note_to_workspace', expect.objectContaining({
      source_vault_path: '/personal',
      destination_vault_path: '/team',
      old_path: '/personal/notes/project-kickoff.md',
      replacement_target: 'team/notes/project-kickoff',
    }))
    expect(onEntryRenamed).toHaveBeenCalledWith(
      '/personal/notes/project-kickoff.md',
      expect.objectContaining({
        path: '/team/notes/project-kickoff.md',
        filename: 'project-kickoff.md',
        workspace: destinationWorkspace,
      }),
      '# Project Kickoff\n',
    )
    expect(setToastMessage).toHaveBeenCalledWith('Moved to "Team" and updated 1 note')
  })
})
