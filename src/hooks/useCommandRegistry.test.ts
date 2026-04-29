import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useCommandRegistry, buildTypeCommands, extractVaultTypes, pluralizeType, groupSortKey } from './useCommandRegistry'
import type { CommandAction } from './useCommandRegistry'
import { NEW_AI_CHAT_EVENT, OPEN_AI_CHAT_EVENT } from '../utils/aiPromptBridge'
import { formatShortcutDisplay } from './appCommandCatalog'

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    activeTabPath: '/vault/test.md',
    entries: [],
    modifiedCount: 0,
    onQuickOpen: vi.fn(),
    onCreateNote: vi.fn(),
    onCreateNoteOfType: vi.fn(),
    onSave: vi.fn(),
    onOpenSettings: vi.fn(),
    onDeleteNote: vi.fn(),
    onArchiveNote: vi.fn(),
    onUnarchiveNote: vi.fn(),
    onToggleOrganized: vi.fn(),
    onCommitPush: vi.fn(),
    onResolveConflicts: vi.fn(),
    onSetViewMode: vi.fn(),
    onToggleInspector: vi.fn(),
    onToggleDiff: vi.fn(),
    onToggleRawEditor: vi.fn(),
    noteWidth: 'normal',
    defaultNoteWidth: 'normal',
    onSetNoteWidth: vi.fn(),
    onSetDefaultNoteWidth: vi.fn(),
    onToggleAIChat: vi.fn(),
    onOpenVault: vi.fn(),
    activeNoteModified: false,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    zoomLevel: 100,
    onSelect: vi.fn(),
    onCloseTab: vi.fn(),
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    canGoBack: false,
    canGoForward: false,
    onCheckForUpdates: vi.fn(),
    onCreateType: vi.fn(),
    ...overrides,
  }
}

function findCommand(commands: CommandAction[], id: string): CommandAction | undefined {
  return commands.find(c => c.id === id)
}

describe('useCommandRegistry', () => {
  it('includes resolve-conflicts command in Git group', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'resolve-conflicts')
    expect(cmd).toBeDefined()
    expect(cmd!.group).toBe('Git')
    expect(cmd!.label).toBe('Resolve Conflicts')
  })

  it('resolve-conflicts is always enabled', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'resolve-conflicts')
    expect(cmd!.enabled).toBe(true)
  })

  it('resolve-conflicts executes onResolveConflicts callback', () => {
    const onResolveConflicts = vi.fn()
    const config = makeConfig({ onResolveConflicts })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'resolve-conflicts')
    cmd!.execute()
    expect(onResolveConflicts).toHaveBeenCalled()
  })

  it('resolve-conflicts has searchable keywords', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'resolve-conflicts')
    expect(cmd!.keywords).toContain('conflict')
    expect(cmd!.keywords).toContain('merge')
  })

  it('commit-push is enabled when modifiedCount > 0', () => {
    const config = makeConfig({ modifiedCount: 5 })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'commit-push')
    expect(cmd!.enabled).toBe(true)
  })

  it('commit-push is disabled when modifiedCount is 0', () => {
    const config = makeConfig({ modifiedCount: 0 })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'commit-push')
    expect(cmd!.enabled).toBe(false)
  })

  it('includes initialize-git command for non-git vaults', () => {
    const onInitializeGit = vi.fn()
    const config = makeConfig({ isGitVault: false, onInitializeGit })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'initialize-git')

    expect(cmd).toBeDefined()
    expect(cmd!.group).toBe('Git')
    expect(cmd!.label).toBe('Initialize Git for Current Vault')
    expect(cmd!.enabled).toBe(true)

    cmd!.execute()
    expect(onInitializeGit).toHaveBeenCalledOnce()
  })

  it('hides remote git commands for non-git vaults', () => {
    const config = makeConfig({ isGitVault: false, modifiedCount: 5 })
    const { result } = renderHook(() => useCommandRegistry(config))

    expect(findCommand(result.current, 'commit-push')).toBeUndefined()
    expect(findCommand(result.current, 'git-pull')).toBeUndefined()
    expect(findCommand(result.current, 'add-remote')).toBeUndefined()
    expect(findCommand(result.current, 'view-changes')).toBeUndefined()
  })

  it('resolve-conflicts stays enabled across rerenders', () => {
    const config = makeConfig()
    const { result, rerender } = renderHook(
      (props) => useCommandRegistry(props),
      { initialProps: config },
    )
    expect(findCommand(result.current, 'resolve-conflicts')!.enabled).toBe(true)

    rerender(makeConfig())
    expect(findCommand(result.current, 'resolve-conflicts')!.enabled).toBe(true)
  })

  it('includes set-note-icon command in Note group', () => {
    const config = makeConfig({ onSetNoteIcon: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'set-note-icon')
    expect(cmd).toBeDefined()
    expect(cmd!.group).toBe('Note')
    expect(cmd!.label).toBe('Set Note Icon')
  })

  it('set-note-icon is enabled when active note and callback exist', () => {
    const config = makeConfig({ onSetNoteIcon: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'set-note-icon')
    expect(cmd!.enabled).toBe(true)
  })

  it('set-note-icon is disabled when no active note', () => {
    const config = makeConfig({ activeTabPath: null, onSetNoteIcon: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'set-note-icon')
    expect(cmd!.enabled).toBe(false)
  })

  it('remove-note-icon is enabled when active note has icon', () => {
    const config = makeConfig({ onRemoveNoteIcon: vi.fn(), activeNoteHasIcon: true })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'remove-note-icon')
    expect(cmd!.enabled).toBe(true)
  })

  it('remove-note-icon is disabled when active note has no icon', () => {
    const config = makeConfig({ onRemoveNoteIcon: vi.fn(), activeNoteHasIcon: false })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'remove-note-icon')
    expect(cmd!.enabled).toBe(false)
  })

  it('set-note-icon executes callback', () => {
    const onSetNoteIcon = vi.fn()
    const config = makeConfig({ onSetNoteIcon })
    const { result } = renderHook(() => useCommandRegistry(config))
    findCommand(result.current, 'set-note-icon')!.execute()
    expect(onSetNoteIcon).toHaveBeenCalled()
  })

  it('includes Change Note Type when the active note can be retargeted', () => {
    const onChangeNoteType = vi.fn()
    const config = makeConfig({ onChangeNoteType })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'change-note-type')

    expect(cmd).toBeDefined()
    expect(cmd!.enabled).toBe(true)

    cmd!.execute()
    expect(onChangeNoteType).toHaveBeenCalledOnce()
  })

  it('enables Move Note to Folder only when another folder destination exists', () => {
    const onMoveNoteToFolder = vi.fn()
    const { result, rerender } = renderHook(
      (props) => useCommandRegistry(props),
      {
        initialProps: makeConfig({
          onMoveNoteToFolder,
          canMoveNoteToFolder: true,
        }),
      },
    )

    expect(findCommand(result.current, 'move-note-to-folder')?.enabled).toBe(true)
    findCommand(result.current, 'move-note-to-folder')!.execute()
    expect(onMoveNoteToFolder).toHaveBeenCalledOnce()

    rerender(makeConfig({
      onMoveNoteToFolder,
      canMoveNoteToFolder: false,
    }))
    expect(findCommand(result.current, 'move-note-to-folder')?.enabled).toBe(false)
  })

  it('includes restore deleted note command when provided', () => {
    const config = makeConfig({ onRestoreDeletedNote: vi.fn(), canRestoreDeletedNote: true })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'restore-deleted-note')
    expect(cmd).toBeDefined()
    expect(cmd!.enabled).toBe(true)
  })

  it('disables restore deleted note when there is no deleted preview', () => {
    const config = makeConfig({ onRestoreDeletedNote: vi.fn(), canRestoreDeletedNote: false })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'restore-deleted-note')
    expect(cmd!.enabled).toBe(false)
  })

  it('includes Customize Inbox columns when the Inbox action is available', () => {
    const onCustomizeNoteListColumns = vi.fn()
    const config = makeConfig({
      selection: { kind: 'filter', filter: 'inbox' },
      onCustomizeNoteListColumns,
      canCustomizeNoteListColumns: true,
    })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'customize-note-list-columns')
    expect(cmd).toBeDefined()
    expect(cmd!.enabled).toBe(true)
    expect(cmd!.label).toBe('Customize Inbox columns')

    cmd!.execute()
    expect(onCustomizeNoteListColumns).toHaveBeenCalled()
  })

  it('includes Customize All Notes columns in the all-notes view', () => {
    const config = makeConfig({
      selection: { kind: 'filter', filter: 'all' },
      onCustomizeNoteListColumns: vi.fn(),
      canCustomizeNoteListColumns: true,
    })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'customize-note-list-columns')
    expect(cmd).toBeDefined()
    expect(cmd!.enabled).toBe(true)
    expect(cmd!.label).toBe('Customize All Notes columns')
  })

  it('disables note-list column customization outside supported views', () => {
    const config = makeConfig({
      selection: { kind: 'sectionGroup', type: 'Book' },
      onCustomizeNoteListColumns: vi.fn(),
      canCustomizeNoteListColumns: false,
    })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'customize-note-list-columns')
    expect(cmd!.enabled).toBe(false)
  })

  it('shows Cmd+E on toggle organized and removes it from archive note', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useCommandRegistry(config))
    expect(findCommand(result.current, 'toggle-organized')?.shortcut).toBe(
      formatShortcutDisplay({ display: '⌘E' }),
    )
    expect(findCommand(result.current, 'archive-note')?.shortcut).toBeUndefined()
  })

  it('exposes active file actions when a note is selected', () => {
    const onRevealActiveFile = vi.fn()
    const onCopyActiveFilePath = vi.fn()
    const config = makeConfig({
      activeTabPath: '/vault/current.md',
      entries: [{ path: '/vault/current.md', title: 'Current', fileKind: 'markdown' }],
      onRevealActiveFile,
      onCopyActiveFilePath,
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    expect(findCommand(result.current, 'reveal-active-file')).toMatchObject({
      enabled: true,
      group: 'Note',
      label: 'Reveal in Finder',
    })
    expect(findCommand(result.current, 'copy-active-file-path')).toMatchObject({
      enabled: true,
      group: 'Note',
      label: 'Copy File Path',
    })

    findCommand(result.current, 'reveal-active-file')!.execute()
    findCommand(result.current, 'copy-active-file-path')!.execute()

    expect(onRevealActiveFile).toHaveBeenCalledWith('/vault/current.md')
    expect(onCopyActiveFilePath).toHaveBeenCalledWith('/vault/current.md')
  })

  it('only enables external open for non-markdown active files', () => {
    const onOpenActiveFileExternal = vi.fn()
    const { result, rerender } = renderHook(
      (props) => useCommandRegistry(props),
      {
        initialProps: makeConfig({
          activeTabPath: '/vault/current.md',
          entries: [{ path: '/vault/current.md', title: 'Current', fileKind: 'markdown' }],
          onOpenActiveFileExternal,
        }),
      },
    )

    expect(findCommand(result.current, 'open-active-file-external')?.enabled).toBe(false)

    rerender(makeConfig({
      activeTabPath: '/vault/Attachments/photo.png',
      entries: [{ path: '/vault/Attachments/photo.png', title: 'photo.png', fileKind: 'binary' }],
      onOpenActiveFileExternal,
    }))

    const command = findCommand(result.current, 'open-active-file-external')!
    expect(command.enabled).toBe(true)
    command.execute()
    expect(onOpenActiveFileExternal).toHaveBeenCalledWith('/vault/Attachments/photo.png')
  })

  it('disables Toggle Raw Editor when the active file cannot switch to rich mode', () => {
    const config = makeConfig({ onToggleRawEditor: undefined })
    const { result } = renderHook(() => useCommandRegistry(config))
    expect(findCommand(result.current, 'toggle-raw-editor')?.enabled).toBe(false)
  })

  it('exposes command palette actions for note width modes', () => {
    const onSetNoteWidth = vi.fn()
    const config = makeConfig({ noteWidth: 'normal', onSetNoteWidth })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'set-note-width-wide')

    expect(cmd).toBeDefined()
    expect(cmd!.group).toBe('View')
    expect(cmd!.label).toBe('Use Wide Note Width')
    expect(cmd!.keywords).toContain('wide')

    cmd!.execute()

    expect(onSetNoteWidth).toHaveBeenCalledWith('wide')
  })

  it('exposes command palette actions for moving the selected saved view', () => {
    const onMoveSelectedViewUp = vi.fn()
    const onMoveSelectedViewDown = vi.fn()
    const config = makeConfig({
      selectedViewName: 'Active Projects',
      onMoveSelectedViewUp,
      onMoveSelectedViewDown,
      canMoveSelectedViewUp: true,
      canMoveSelectedViewDown: true,
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    const moveUp = findCommand(result.current, 'move-view-up')
    const moveDown = findCommand(result.current, 'move-view-down')

    expect(moveUp).toMatchObject({
      label: 'Move Active Projects Up',
      group: 'View',
      enabled: true,
    })
    expect(moveDown).toMatchObject({
      label: 'Move Active Projects Down',
      group: 'View',
      enabled: true,
    })

    moveUp!.execute()
    moveDown!.execute()

    expect(onMoveSelectedViewUp).toHaveBeenCalledOnce()
    expect(onMoveSelectedViewDown).toHaveBeenCalledOnce()
  })

  it('disables saved view move commands at list boundaries', () => {
    const config = makeConfig({
      selectedViewName: 'Top View',
      onMoveSelectedViewUp: vi.fn(),
      onMoveSelectedViewDown: vi.fn(),
      canMoveSelectedViewUp: false,
      canMoveSelectedViewDown: true,
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    expect(findCommand(result.current, 'move-view-up')?.enabled).toBe(false)
    expect(findCommand(result.current, 'move-view-down')?.enabled).toBe(true)
  })

  it('disables the command for the active note width mode', () => {
    const config = makeConfig({ noteWidth: 'wide' })
    const { result } = renderHook(() => useCommandRegistry(config))

    expect(findCommand(result.current, 'set-note-width-wide')?.enabled).toBe(false)
    expect(findCommand(result.current, 'set-note-width-normal')?.enabled).toBe(true)
  })

  it('exposes command palette actions for the default note width', () => {
    const onSetDefaultNoteWidth = vi.fn()
    const config = makeConfig({ defaultNoteWidth: 'normal', onSetDefaultNoteWidth })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'set-default-note-width-wide')

    expect(cmd).toMatchObject({
      label: 'Use Wide Note Width by Default',
      group: 'View',
      enabled: true,
    })

    cmd!.execute()
    expect(onSetDefaultNoteWidth).toHaveBeenCalledWith('wide')
  })

  it('exposes command palette actions for light and dark mode', () => {
    const onSetThemeMode = vi.fn()
    const config = makeConfig({ onSetThemeMode })
    const { result } = renderHook(() => useCommandRegistry(config))
    const lightMode = findCommand(result.current, 'use-light-mode')
    const darkMode = findCommand(result.current, 'use-dark-mode')

    expect(lightMode).toMatchObject({
      label: 'Use Light Mode',
      enabled: true,
      group: 'Settings',
    })
    expect(darkMode).toMatchObject({
      label: 'Use Dark Mode',
      enabled: true,
      group: 'Settings',
    })

    lightMode?.execute()
    darkMode?.execute()

    expect(onSetThemeMode).toHaveBeenNthCalledWith(1, 'light')
    expect(onSetThemeMode).toHaveBeenNthCalledWith(2, 'dark')
  })

  it('includes a New AI chat command that opens and resets the panel session', () => {
    const config = makeConfig()
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'new-ai-chat')

    expect(cmd).toBeDefined()
    expect(cmd!.group).toBe('View')
    expect(cmd!.label).toBe('New AI chat')
    expect(cmd!.enabled).toBe(true)

    cmd!.execute()

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: NEW_AI_CHAT_EVENT }))
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: OPEN_AI_CHAT_EVENT }))
    dispatchSpy.mockRestore()
  })

  it('omits Inbox navigation when the explicit workflow is disabled', () => {
    const config = makeConfig({ showInbox: false })
    const { result } = renderHook(() => useCommandRegistry(config))
    expect(findCommand(result.current, 'go-inbox')).toBeUndefined()
  })

  it('enables folder commands when a folder is selected', () => {
    const config = makeConfig({
      selection: { kind: 'folder', path: 'projects' },
      onRenameFolder: vi.fn(),
      onDeleteFolder: vi.fn(),
      onRevealSelectedFolder: vi.fn(),
      onCopySelectedFolderPath: vi.fn(),
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    expect(findCommand(result.current, 'reveal-selected-folder')?.enabled).toBe(true)
    expect(findCommand(result.current, 'copy-selected-folder-path')?.enabled).toBe(true)
    expect(findCommand(result.current, 'rename-folder')?.enabled).toBe(true)
    expect(findCommand(result.current, 'delete-folder')?.enabled).toBe(true)
  })

  it('disables folder commands outside folder selection', () => {
    const config = makeConfig({
      selection: { kind: 'filter', filter: 'all' },
      onRenameFolder: vi.fn(),
      onDeleteFolder: vi.fn(),
      onRevealSelectedFolder: vi.fn(),
      onCopySelectedFolderPath: vi.fn(),
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    expect(findCommand(result.current, 'reveal-selected-folder')?.enabled).toBe(false)
    expect(findCommand(result.current, 'copy-selected-folder-path')?.enabled).toBe(false)
    expect(findCommand(result.current, 'rename-folder')?.enabled).toBe(false)
    expect(findCommand(result.current, 'delete-folder')?.enabled).toBe(false)
  })

  it('executes folder command callbacks', () => {
    const onRenameFolder = vi.fn()
    const onDeleteFolder = vi.fn()
    const onRevealSelectedFolder = vi.fn()
    const onCopySelectedFolderPath = vi.fn()
    const config = makeConfig({
      selection: { kind: 'folder', path: 'projects' },
      onRenameFolder,
      onDeleteFolder,
      onRevealSelectedFolder,
      onCopySelectedFolderPath,
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    findCommand(result.current, 'reveal-selected-folder')!.execute()
    findCommand(result.current, 'copy-selected-folder-path')!.execute()
    findCommand(result.current, 'rename-folder')!.execute()
    findCommand(result.current, 'delete-folder')!.execute()

    expect(onRevealSelectedFolder).toHaveBeenCalledTimes(1)
    expect(onCopySelectedFolderPath).toHaveBeenCalledTimes(1)
    expect(onRenameFolder).toHaveBeenCalledTimes(1)
    expect(onDeleteFolder).toHaveBeenCalledTimes(1)
  })

  it('omits the removed daily-note command', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useCommandRegistry(config))
    expect(findCommand(result.current, 'open-daily-note')).toBeUndefined()
  })

  it('includes Contribute in the Settings group when available', () => {
    const onOpenFeedback = vi.fn()
    const config = makeConfig({ onOpenFeedback })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'open-contribute')
    expect(cmd).toBeDefined()
    expect(cmd!.label).toBe('Contribute')
    expect(cmd!.group).toBe('Settings')
    expect(cmd!.enabled).toBe(true)

    cmd!.execute()
    expect(onOpenFeedback).toHaveBeenCalledOnce()
  })

  it('keeps a single canonical New Note command when generic note types are present', () => {
    const config = makeConfig({
      entries: [
        { path: '/type-note.md', title: 'Note', isA: 'Type' },
        { path: '/lowercase-note.md', title: 'lowercase-note', isA: 'note' },
      ],
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    const newNoteCommands = result.current.filter(command => command.label.toLowerCase() === 'new note')

    expect(newNoteCommands).toHaveLength(1)
    expect(newNoteCommands[0]).toMatchObject({
      id: 'create-note',
      shortcut: formatShortcutDisplay({ display: '⌘N' }),
    })
  })

  it('keeps a single canonical New Type command when the Type definition exists', () => {
    const onCreateType = vi.fn()
    const onCreateNoteOfType = vi.fn()
    const config = makeConfig({
      onCreateType,
      onCreateNoteOfType,
      entries: [
        { path: '/type-definition.md', title: 'Type', isA: 'Type' },
        { path: '/recipe-definition.md', title: 'Recipe', isA: 'Type' },
      ],
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    const newTypeCommands = result.current.filter(command => command.label === 'New Type')

    expect(newTypeCommands).toHaveLength(1)
    expect(newTypeCommands[0]).toMatchObject({
      id: 'create-type',
      group: 'Note',
    })
    expect(findCommand(result.current, 'list-type')).toMatchObject({
      label: 'List Types',
      group: 'Navigation',
    })

    newTypeCommands[0].execute()
    expect(onCreateType).toHaveBeenCalledOnce()
    expect(onCreateNoteOfType).not.toHaveBeenCalled()
  })
})

describe('pluralizeType', () => {
  it('pluralizes regular types', () => {
    expect(pluralizeType('Project')).toBe('Projects')
    expect(pluralizeType('Note')).toBe('Notes')
  })

  it('uses overrides for irregular plurals', () => {
    expect(pluralizeType('Person')).toBe('People')
    expect(pluralizeType('Responsibility')).toBe('Responsibilities')
  })

  it('handles sibilant endings', () => {
    expect(pluralizeType('Address')).toBe('Addresses')
  })
})

describe('extractVaultTypes', () => {
  it('returns default types when no entries', () => {
    expect(extractVaultTypes([])).toEqual(['Event', 'Person', 'Project', 'Note'])
  })

  it('extracts unique types from entries', () => {
    const entries = [
      { path: '/a', title: 'A', isA: 'Project' },
      { path: '/b', title: 'B', isA: 'Project' },
      { path: '/c', title: 'C', isA: 'Event' },
    ] as never[]
    const types = extractVaultTypes(entries)
    expect(types).toContain('Project')
    expect(types).toContain('Event')
    expect(types).toHaveLength(2)
  })

  it('includes types from Type definition entries', () => {
    const entries = [
      { path: '/book.md', title: 'Book', isA: 'Type' },
    ] as never[]
    const types = extractVaultTypes(entries)
    expect(types).toContain('Book')
  })

  it('includes types from both definitions and instances', () => {
    const entries = [
      { path: '/book.md', title: 'Book', isA: 'Type' },
      { path: '/hp.md', title: 'Harry Potter', isA: 'Book' },
      { path: '/person.md', title: 'Person', isA: 'Type' },
    ] as never[]
    const types = extractVaultTypes(entries)
    expect(types).toContain('Book')
    expect(types).toContain('Person')
    expect(types).toHaveLength(2)
  })

  it('deduplicates default types case-insensitively and keeps canonical casing', () => {
    const entries = [
      { path: '/note-type.md', title: 'note', isA: 'Type' },
      { path: '/note-instance.md', title: 'Example', isA: 'Note' },
      { path: '/project-instance.md', title: 'Project Plan', isA: 'project' },
    ] as never[]

    expect(extractVaultTypes(entries)).toEqual(['Note', 'Project'])
  })

  it('omits the legacy Journal type when no Type document defines it', () => {
    const entries = [
      { path: '/2026-03-11.md', title: 'March 11', isA: 'Journal' },
      { path: '/note.md', title: 'General Note', isA: 'Note' },
    ] as never[]

    expect(extractVaultTypes(entries)).toEqual(['Note'])
  })

  it('includes Journal when a real Type document defines it', () => {
    const entries = [
      { path: '/journal.md', title: 'Journal', isA: 'Type' },
      { path: '/2026-03-11.md', title: 'March 11', isA: 'Journal' },
      { path: '/note.md', title: 'General Note', isA: 'Note' },
    ] as never[]

    expect(extractVaultTypes(entries)).toEqual(['Journal', 'Note'])
  })

  it('omits hidden types from extracted command-palette types', () => {
    const entries = [
      { path: '/recipe.md', title: 'Recipe', isA: 'Type', visible: false },
      { path: '/dinner.md', title: 'Dinner', isA: 'Recipe' },
      { path: '/project.md', title: 'Project', isA: 'Type' },
    ] as never[]

    expect(extractVaultTypes(entries)).toEqual(['Project'])
  })
})

describe('groupSortKey', () => {
  it('returns correct order for groups', () => {
    expect(groupSortKey('Navigation')).toBeLessThan(groupSortKey('Note'))
    expect(groupSortKey('Note')).toBeLessThan(groupSortKey('Git'))
    expect(groupSortKey('Git')).toBeLessThan(groupSortKey('View'))
  })
})

describe('install-mcp command', () => {
  it('is enabled when mcpStatus is not_installed and handler provided', () => {
    const config = makeConfig({ mcpStatus: 'not_installed', onInstallMcp: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'install-mcp')
    expect(cmd).toBeDefined()
    expect(cmd!.enabled).toBe(true)
    expect(cmd!.label).toBe('Set Up External AI Tools…')
  })

  it('is enabled when mcpStatus is installed and handler provided (manage use case)', () => {
    const config = makeConfig({ mcpStatus: 'installed', onInstallMcp: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'install-mcp')
    expect(cmd!.enabled).toBe(true)
    expect(cmd!.label).toBe('Manage External AI Tools…')
  })

  it('is enabled even when mcpStatus is checking', () => {
    const config = makeConfig({ mcpStatus: 'checking', onInstallMcp: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'install-mcp')
    expect(cmd!.enabled).toBe(true)
  })

  it('is enabled even when no handler provided', () => {
    const config = makeConfig({ mcpStatus: 'not_installed' })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'install-mcp')
    expect(cmd!.enabled).toBe(true)
  })

  it('has setup keywords for discoverability', () => {
    const config = makeConfig({ mcpStatus: 'installed', onInstallMcp: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'install-mcp')
    expect(cmd!.keywords).toContain('setup')
    expect(cmd!.keywords).toContain('external')
    expect(cmd!.keywords).toContain('mcp')
    expect(cmd!.keywords).toContain('cursor')
  })

  it('executes onInstallMcp callback', () => {
    const onInstallMcp = vi.fn()
    const config = makeConfig({ mcpStatus: 'installed', onInstallMcp })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'install-mcp')
    cmd!.execute()
    expect(onInstallMcp).toHaveBeenCalled()
  })

  it('is in Settings group', () => {
    const config = makeConfig({ mcpStatus: 'installed', onInstallMcp: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'install-mcp')
    expect(cmd!.group).toBe('Settings')
  })
})

describe('reload-vault command', () => {
  it('is present in Settings group', () => {
    const config = makeConfig({ onReloadVault: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'reload-vault')
    expect(cmd).toBeDefined()
    expect(cmd!.group).toBe('Settings')
    expect(cmd!.label).toBe('Reload Vault')
  })

  it('is enabled when onReloadVault is provided', () => {
    const config = makeConfig({ onReloadVault: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'reload-vault')
    expect(cmd!.enabled).toBe(true)
  })

  it('is disabled when onReloadVault is not provided', () => {
    const config = makeConfig()
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'reload-vault')
    expect(cmd!.enabled).toBe(false)
  })

  it('executes onReloadVault callback', () => {
    const onReloadVault = vi.fn()
    const config = makeConfig({ onReloadVault })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'reload-vault')
    cmd!.execute()
    expect(onReloadVault).toHaveBeenCalled()
  })

  it('has searchable keywords', () => {
    const config = makeConfig({ onReloadVault: vi.fn() })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'reload-vault')
    expect(cmd!.keywords).toContain('reload')
    expect(cmd!.keywords).toContain('refresh')
    expect(cmd!.keywords).toContain('rescan')
  })

  it('builds explicit AI agent switch commands for installed alternatives', () => {
    const onSetDefaultAiAgent = vi.fn()
    const config = makeConfig({
      aiAgentsStatus: {
        claude_code: { status: 'installed', version: '1.0.20' },
        codex: { status: 'installed', version: '0.37.0' },
        opencode: { status: 'installed', version: '0.3.1' },
        pi: { status: 'installed', version: '0.70.2' },
        gemini: { status: 'installed', version: '0.5.1' },
      },
      selectedAiAgent: 'claude_code',
      onSetDefaultAiAgent,
    })
    const { result } = renderHook(() => useCommandRegistry(config))
    const cmd = findCommand(result.current, 'switch-ai-agent-codex')

    expect(cmd).toBeDefined()
    expect(cmd!.label).toBe('Switch AI Agent to Codex')
    expect(findCommand(result.current, 'switch-ai-agent-opencode')).toBeDefined()
    expect(findCommand(result.current, 'switch-ai-agent-pi')).toBeDefined()
    expect(findCommand(result.current, 'switch-ai-agent-gemini')).toBeDefined()

    cmd!.execute()
    expect(onSetDefaultAiAgent).toHaveBeenCalledWith('codex')
    expect(findCommand(result.current, 'switch-default-ai-agent')).toBeUndefined()
  })

  it('omits explicit AI switch commands when no alternate installed agent exists', () => {
    const config = makeConfig({
      aiAgentsStatus: {
        claude_code: { status: 'installed', version: '1.0.20' },
        codex: { status: 'missing', version: null },
        opencode: { status: 'missing', version: null },
        pi: { status: 'missing', version: null },
        gemini: { status: 'missing', version: null },
      },
      selectedAiAgent: 'claude_code',
      onSetDefaultAiAgent: vi.fn(),
    })
    const { result } = renderHook(() => useCommandRegistry(config))

    expect(findCommand(result.current, 'switch-ai-agent-codex')).toBeUndefined()
    expect(findCommand(result.current, 'switch-ai-agent-opencode')).toBeUndefined()
    expect(findCommand(result.current, 'switch-ai-agent-pi')).toBeUndefined()
    expect(findCommand(result.current, 'switch-ai-agent-gemini')).toBeUndefined()
    expect(findCommand(result.current, 'switch-default-ai-agent')).toBeUndefined()
  })
})

describe('buildTypeCommands', () => {
  it('creates new and list commands for each type', () => {
    const onCreateNoteOfType = vi.fn()
    const onSelect = vi.fn()
    const commands = buildTypeCommands(['Project', 'Event'], onCreateNoteOfType, onSelect)
    expect(commands).toHaveLength(4)
    expect(commands[0].id).toBe('new-project')
    expect(commands[1].id).toBe('list-project')
    expect(commands[2].id).toBe('new-event')
    expect(commands[3].id).toBe('list-event')
  })

  it('omits the generic Note create command while keeping navigation for notes', () => {
    const onCreateNoteOfType = vi.fn()
    const onSelect = vi.fn()
    const commands = buildTypeCommands(['Note', 'Project'], onCreateNoteOfType, onSelect)

    expect(commands.map(command => command.id)).toEqual([
      'list-note',
      'new-project',
      'list-project',
    ])
  })
})
