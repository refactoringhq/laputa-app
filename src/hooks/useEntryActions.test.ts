import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { VaultEntry } from '../types'
import { useEntryActions } from './useEntryActions'

const NOTE_PATH = '/vault/note/test.md'
const PROJECT_TEMPLATE = '## Objective\n\n## Notes'

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: NOTE_PATH,
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null, sidebarLabel: null,
  template: null, sort: null, view: null, visible: null,
  outgoingLinks: [],
  properties: {},
  ...overrides,
})

type EntryActions = ReturnType<typeof useEntryActions>

const makeTypeEntry = (title: string, overrides: Partial<VaultEntry> = {}): VaultEntry =>
  makeEntry({
    isA: 'Type',
    title,
    path: `/vault/${title.toLowerCase()}.md`,
    ...overrides,
  })

describe('useEntryActions', () => {
  const updateEntry = vi.fn()
  const handleUpdateFrontmatter = vi.fn().mockResolvedValue(undefined)
  const handleDeleteProperty = vi.fn().mockResolvedValue(undefined)
  const setToastMessage = vi.fn()
  const createTypeEntry = vi.fn().mockImplementation((typeName: string) =>
    Promise.resolve(makeEntry({ isA: 'Type', title: typeName, path: `/vault/${typeName.toLowerCase()}.md` })),
  )

  function setup(entries: VaultEntry[] = []) {
    return renderHook(() =>
      useEntryActions({
        entries,
        updateEntry,
        handleUpdateFrontmatter,
        handleDeleteProperty,
        setToastMessage,
        createTypeEntry,
        onFrontmatterPersisted,
      })
    )
  }

  const onFrontmatterPersisted = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function runAction(action: () => Promise<unknown>) {
    await act(async () => {
      await action()
    })
  }

  function expectFrontmatterUpdate(path: string, key: string, value: unknown, options?: unknown) {
    if (options === undefined) {
      expect(handleUpdateFrontmatter).toHaveBeenCalledWith(path, key, value)
      return
    }
    expect(handleUpdateFrontmatter).toHaveBeenCalledWith(path, key, value, options)
  }

  function expectEntryUpdate(path: string, patch: Partial<VaultEntry>) {
    expect(updateEntry).toHaveBeenCalledWith(path, patch)
  }

  async function expectArchiveAction({
    run,
    assertWrite,
    patch,
    toast,
  }: {
    run: (actions: EntryActions) => Promise<unknown>
    assertWrite: () => void
    patch: Partial<VaultEntry>
    toast: string
  }) {
    const { result } = setup()

    await runAction(() => run(result.current))

    assertWrite()
    expectEntryUpdate(NOTE_PATH, patch)
    expect(setToastMessage).toHaveBeenCalledWith(toast)
    expect(onFrontmatterPersisted).toHaveBeenCalledTimes(1)
  }

  async function expectDiskFailure(action: () => Promise<unknown>) {
    await expect(act(action)).rejects.toThrow('disk full')
    expect(updateEntry).not.toHaveBeenCalled()
  }

  function silenceConsoleError() {
    return vi.spyOn(console, 'error').mockImplementation(() => {})
  }

  describe('handleArchiveNote', () => {
    it('sets archived frontmatter and updates entry state', async () => {
      await expectArchiveAction({
        run: (actions) => actions.handleArchiveNote(NOTE_PATH),
        assertWrite: () => {
          expectFrontmatterUpdate(NOTE_PATH, '_archived', true, { silent: true })
        },
        patch: { archived: true },
        toast: 'Note archived',
      })
    })

    it('final toast is contextual, not "Property updated"', async () => {
      const { result } = setup()
      const toastCalls: (string | null)[] = []
      setToastMessage.mockImplementation((msg: string | null) => toastCalls.push(msg))

      await runAction(() => result.current.handleArchiveNote(NOTE_PATH))

      expect(toastCalls).toEqual(['Note archived'])
    })
  })

  describe('handleUnarchiveNote', () => {
    it('clears archived frontmatter and updates entry state', async () => {
      await expectArchiveAction({
        run: (actions) => actions.handleUnarchiveNote(NOTE_PATH),
        assertWrite: () => {
          expect(handleDeleteProperty).toHaveBeenCalledWith(NOTE_PATH, '_archived', { silent: true })
          expect(handleUpdateFrontmatter).not.toHaveBeenCalled()
        },
        patch: { archived: false },
        toast: 'Note unarchived',
      })
    })
  })

  describe('handleCustomizeType', () => {
    it('updates icon and color on the type entry', async () => {
      const typeEntry = makeTypeEntry('Recipe')
      const { result } = setup([typeEntry])

      await runAction(() => result.current.handleCustomizeType('Recipe', 'cooking-pot', 'green'))

      expectFrontmatterUpdate('/vault/recipe.md', 'icon', 'cooking-pot')
      expectFrontmatterUpdate('/vault/recipe.md', 'color', 'green')
      expectEntryUpdate('/vault/recipe.md', { icon: 'cooking-pot', color: 'green' })
      expect(onFrontmatterPersisted).toHaveBeenCalled()
    })

    it('auto-creates type entry when not found and applies customization', async () => {
      const { result } = setup([])

      await runAction(() => result.current.handleCustomizeType('Recipe', 'star', 'red'))

      expect(createTypeEntry).toHaveBeenCalledWith('Recipe')
      expectEntryUpdate('/vault/recipe.md', { icon: 'star', color: 'red' })
      expectFrontmatterUpdate('/vault/recipe.md', 'icon', 'star')
      expectFrontmatterUpdate('/vault/recipe.md', 'color', 'red')
    })

    it('serializes frontmatter writes (icon before color)', async () => {
      const callOrder: string[] = []
      handleUpdateFrontmatter.mockImplementation((_path: string, key: string) => {
        callOrder.push(key)
        return Promise.resolve()
      })
      const typeEntry = makeTypeEntry('Project')
      const { result } = setup([typeEntry])

      await runAction(() => result.current.handleCustomizeType('Project', 'wrench', 'blue'))

      expect(callOrder).toEqual(['icon', 'color'])
    })
  })

  describe('handleUpdateTypeTemplate', () => {
    it('updates template on the type entry', async () => {
      const typeEntry = makeTypeEntry('Project')
      const { result } = setup([typeEntry])

      await runAction(() => result.current.handleUpdateTypeTemplate('Project', PROJECT_TEMPLATE))

      expectFrontmatterUpdate('/vault/project.md', 'template', PROJECT_TEMPLATE)
      expectEntryUpdate('/vault/project.md', { template: PROJECT_TEMPLATE })
      expect(onFrontmatterPersisted).toHaveBeenCalled()
    })

    it('sets template to null when empty string', async () => {
      const typeEntry = makeTypeEntry('Project')
      const { result } = setup([typeEntry])

      await runAction(() => result.current.handleUpdateTypeTemplate('Project', ''))

      expectFrontmatterUpdate('/vault/project.md', 'template', '')
      expectEntryUpdate('/vault/project.md', { template: null })
    })

    it('auto-creates type entry when not found', async () => {
      const { result } = setup([])

      await runAction(() => result.current.handleUpdateTypeTemplate('NonExistent', '## Template'))

      expect(createTypeEntry).toHaveBeenCalledWith('NonExistent')
      expectFrontmatterUpdate('/vault/nonexistent.md', 'template', '## Template')
      expectEntryUpdate('/vault/nonexistent.md', { template: '## Template' })
    })
  })

  describe('handleReorderSections', () => {
    it('updates order on multiple type entries', async () => {
      const typeA = makeTypeEntry('Note')
      const typeB = makeTypeEntry('Project')
      const { result } = setup([typeA, typeB])

      await runAction(() =>
        result.current.handleReorderSections([
          { typeName: 'Note', order: 0 },
          { typeName: 'Project', order: 1 },
        ])
      )

      expectFrontmatterUpdate('/vault/note.md', 'order', 0)
      expectFrontmatterUpdate('/vault/project.md', 'order', 1)
      expectEntryUpdate('/vault/note.md', { order: 0 })
      expectEntryUpdate('/vault/project.md', { order: 1 })
      expect(onFrontmatterPersisted).toHaveBeenCalled()
    })

    it('auto-creates type entries when not found', async () => {
      const typeA = makeTypeEntry('Note')
      const { result } = setup([typeA])

      await runAction(() =>
        result.current.handleReorderSections([
          { typeName: 'Note', order: 0 },
          { typeName: 'Missing', order: 1 },
        ])
      )

      expect(createTypeEntry).toHaveBeenCalledWith('Missing')
      expect(handleUpdateFrontmatter).toHaveBeenCalledTimes(2)
      expectFrontmatterUpdate('/vault/note.md', 'order', 0)
      expectFrontmatterUpdate('/vault/missing.md', 'order', 1)
    })
  })

  describe('handleRenameSection', () => {
    it('writes sidebar label frontmatter and updates entry in memory', async () => {
      const typeEntry = makeTypeEntry('Recipe', { sidebarLabel: null })
      const { result } = setup([typeEntry])

      await runAction(() => result.current.handleRenameSection('Recipe', 'Recipes'))

      expectFrontmatterUpdate('/vault/recipe.md', 'sidebar label', 'Recipes')
      expectEntryUpdate('/vault/recipe.md', { sidebarLabel: 'Recipes' })
      expect(onFrontmatterPersisted).toHaveBeenCalled()
    })

    it('trims whitespace before saving', async () => {
      const typeEntry = makeTypeEntry('Recipe', { sidebarLabel: null })
      const { result } = setup([typeEntry])

      await runAction(() => result.current.handleRenameSection('Recipe', '  Dishes  '))

      expectFrontmatterUpdate('/vault/recipe.md', 'sidebar label', 'Dishes')
      expectEntryUpdate('/vault/recipe.md', { sidebarLabel: 'Dishes' })
    })

    it('deletes sidebar label when label is empty', async () => {
      const typeEntry = makeTypeEntry('Recipe', { sidebarLabel: 'Dishes' })
      const { result } = setup([typeEntry])

      await runAction(() => result.current.handleRenameSection('Recipe', ''))

      expect(handleDeleteProperty).toHaveBeenCalledWith('/vault/recipe.md', 'sidebar label')
      expectEntryUpdate('/vault/recipe.md', { sidebarLabel: null })
      expect(handleUpdateFrontmatter).not.toHaveBeenCalled()
    })

    it('auto-creates type entry when not found', async () => {
      const { result } = setup([])

      await runAction(() => result.current.handleRenameSection('NonExistent', 'Label'))

      expect(createTypeEntry).toHaveBeenCalledWith('NonExistent')
      expectFrontmatterUpdate('/vault/nonexistent.md', 'sidebar label', 'Label')
      expectEntryUpdate('/vault/nonexistent.md', { sidebarLabel: 'Label' })
    })
  })

  describe('handleToggleTypeVisibility', () => {
    it('sets visible to false when currently visible (null/default)', async () => {
      const typeEntry = makeTypeEntry('Journal', { visible: null })
      const { result } = setup([typeEntry])

      await runAction(() => result.current.handleToggleTypeVisibility('Journal'))

      expectFrontmatterUpdate('/vault/journal.md', 'visible', false)
      expectEntryUpdate('/vault/journal.md', { visible: false })
      expect(onFrontmatterPersisted).toHaveBeenCalled()
    })

    it('sets visible to true (deletes property) when currently hidden', async () => {
      const typeEntry = makeTypeEntry('Journal', { visible: false })
      const { result } = setup([typeEntry])

      await runAction(() => result.current.handleToggleTypeVisibility('Journal'))

      expect(handleDeleteProperty).toHaveBeenCalledWith('/vault/journal.md', 'visible')
      expectEntryUpdate('/vault/journal.md', { visible: null })
      expect(onFrontmatterPersisted).toHaveBeenCalled()
    })

    it('auto-creates type entry when not found', async () => {
      const { result } = setup([])

      await runAction(() => result.current.handleToggleTypeVisibility('Journal'))

      expect(createTypeEntry).toHaveBeenCalledWith('Journal')
      expectFrontmatterUpdate('/vault/journal.md', 'visible', false)
      expectEntryUpdate('/vault/journal.md', { visible: false })
    })
  })

  describe('failed disk writes do not update React state', () => {
    it('handleCustomizeType does not update entry when frontmatter write fails', async () => {
      const typeEntry = makeTypeEntry('Recipe')
      handleUpdateFrontmatter.mockRejectedValueOnce(new Error('disk full'))
      const { result } = setup([typeEntry])

      await expectDiskFailure(() => result.current.handleCustomizeType('Recipe', 'star', 'red'))
    })

    it('handleRenameSection does not update entry when frontmatter write fails', async () => {
      const typeEntry = makeTypeEntry('Recipe')
      handleUpdateFrontmatter.mockRejectedValueOnce(new Error('disk full'))
      const { result } = setup([typeEntry])

      await expectDiskFailure(() => result.current.handleRenameSection('Recipe', 'Dishes'))
    })

    it('handleRenameSection does not update entry when delete property fails', async () => {
      const typeEntry = makeTypeEntry('Recipe', { sidebarLabel: 'Dishes' })
      handleDeleteProperty.mockRejectedValueOnce(new Error('disk full'))
      const { result } = setup([typeEntry])

      await expectDiskFailure(() => result.current.handleRenameSection('Recipe', ''))
    })

    it('handleToggleTypeVisibility does not update entry when frontmatter write fails (hide)', async () => {
      const typeEntry = makeTypeEntry('Journal', { visible: null })
      handleUpdateFrontmatter.mockRejectedValueOnce(new Error('disk full'))
      const { result } = setup([typeEntry])

      await expectDiskFailure(() => result.current.handleToggleTypeVisibility('Journal'))
    })

    it('handleToggleTypeVisibility does not update entry when delete property fails (show)', async () => {
      const typeEntry = makeTypeEntry('Journal', { visible: false })
      handleDeleteProperty.mockRejectedValueOnce(new Error('disk full'))
      const { result } = setup([typeEntry])

      await expectDiskFailure(() => result.current.handleToggleTypeVisibility('Journal'))
    })
  })

  describe('optimistic rollback on disk write failure', () => {
    it('rolls back archived state when frontmatter write fails', async () => {
      handleUpdateFrontmatter.mockRejectedValueOnce(new Error('disk full'))
      const errorSpy = silenceConsoleError()
      const { result } = setup()

      await runAction(() => result.current.handleArchiveNote(NOTE_PATH))

      expect(updateEntry).toHaveBeenCalledTimes(2)
      expect(updateEntry).toHaveBeenNthCalledWith(1, NOTE_PATH, { archived: true })
      expect(updateEntry).toHaveBeenNthCalledWith(2, NOTE_PATH, { archived: false })
      expect(setToastMessage).toHaveBeenCalledWith('Failed to archive note — rolled back')
      errorSpy.mockRestore()
    })

    it('rolls back unarchive state when frontmatter write fails', async () => {
      handleDeleteProperty.mockRejectedValueOnce(new Error('disk full'))
      const errorSpy = silenceConsoleError()
      const { result } = setup()

      await runAction(() => result.current.handleUnarchiveNote(NOTE_PATH))

      expect(updateEntry).toHaveBeenCalledTimes(2)
      expect(updateEntry).toHaveBeenNthCalledWith(1, NOTE_PATH, { archived: false })
      expect(updateEntry).toHaveBeenNthCalledWith(2, NOTE_PATH, { archived: true })
      expect(setToastMessage).toHaveBeenCalledWith('Failed to unarchive note — rolled back')
      errorSpy.mockRestore()
    })

  })

  describe('handleToggleFavorite', () => {
    it('favorites a note: writes _favorite and _favorite_index', async () => {
      const entry = makeEntry({ favorite: false, favoriteIndex: null })
      const { result } = setup([entry])

      await runAction(() => result.current.handleToggleFavorite(NOTE_PATH))

      expectFrontmatterUpdate(NOTE_PATH, '_favorite', true, { silent: true })
      expectFrontmatterUpdate(NOTE_PATH, '_favorite_index', 1, { silent: true })
      expectEntryUpdate(NOTE_PATH, { favorite: true, favoriteIndex: 1 })
      expect(onFrontmatterPersisted).toHaveBeenCalledTimes(1)
    })

    it('unfavorites a note: deletes _favorite and _favorite_index', async () => {
      const entry = makeEntry({ favorite: true, favoriteIndex: 0 })
      const { result } = setup([entry])

      await runAction(() => result.current.handleToggleFavorite(NOTE_PATH))

      expect(handleDeleteProperty).toHaveBeenCalledWith(NOTE_PATH, '_favorite', { silent: true })
      expect(handleDeleteProperty).toHaveBeenCalledWith(NOTE_PATH, '_favorite_index', { silent: true })
      expectEntryUpdate(NOTE_PATH, { favorite: false, favoriteIndex: null })
    })

    it('assigns next available index when favoriting', async () => {
      const entries = [
        makeEntry({ path: '/vault/a.md', favorite: true, favoriteIndex: 3 }),
        makeEntry({ path: '/vault/b.md', favorite: true, favoriteIndex: 5 }),
        makeEntry({ path: '/vault/c.md', favorite: false, favoriteIndex: null }),
      ]
      const { result } = setup(entries)

      await runAction(() => result.current.handleToggleFavorite('/vault/c.md'))

      expectFrontmatterUpdate('/vault/c.md', '_favorite_index', 6, { silent: true })
    })

    it('rolls back on failure', async () => {
      const entry = makeEntry({ favorite: false, favoriteIndex: null })
      handleUpdateFrontmatter.mockRejectedValueOnce(new Error('disk full'))
      const errorSpy = silenceConsoleError()
      const { result } = setup([entry])

      await runAction(() => result.current.handleToggleFavorite(NOTE_PATH))

      expectEntryUpdate(NOTE_PATH, { favorite: false, favoriteIndex: null })
      expect(setToastMessage).toHaveBeenCalledWith('Failed to favorite — rolled back')
      errorSpy.mockRestore()
    })

    it('does nothing if entry not found', async () => {
      const { result } = setup([])

      await runAction(() => result.current.handleToggleFavorite('/vault/nonexistent.md'))

      expect(handleUpdateFrontmatter).not.toHaveBeenCalled()
      expect(handleDeleteProperty).not.toHaveBeenCalled()
    })
  })

  describe('handleToggleOrganized', () => {
    it('returns true after organizing is persisted', async () => {
      const entry = makeEntry({ organized: false })
      const { result } = setup([entry])
      let organized = false

      await runAction(async () => {
        organized = await result.current.handleToggleOrganized(NOTE_PATH)
      })

      expect(organized).toBe(true)
      expectFrontmatterUpdate(NOTE_PATH, '_organized', true, { silent: true })
      expectEntryUpdate(NOTE_PATH, { organized: true })
    })

    it('returns false and rolls back when organizing fails', async () => {
      const entry = makeEntry({ organized: false })
      handleUpdateFrontmatter.mockRejectedValueOnce(new Error('disk full'))
      const { result } = setup([entry])
      let organized = true

      await runAction(async () => {
        organized = await result.current.handleToggleOrganized(NOTE_PATH)
      })

      expect(organized).toBe(false)
      expect(updateEntry).toHaveBeenCalledTimes(2)
      expect(updateEntry).toHaveBeenNthCalledWith(1, NOTE_PATH, { organized: true })
      expect(updateEntry).toHaveBeenNthCalledWith(2, NOTE_PATH, { organized: false })
      expect(setToastMessage).toHaveBeenCalledWith('Failed to organize — rolled back')
    })

    it('returns false when the entry is missing', async () => {
      const { result } = setup([])
      let organized = true

      await runAction(async () => {
        organized = await result.current.handleToggleOrganized('/vault/missing.md')
      })

      expect(organized).toBe(false)
      expect(handleUpdateFrontmatter).not.toHaveBeenCalled()
      expect(handleDeleteProperty).not.toHaveBeenCalled()
    })
  })

  describe('handleReorderFavorites', () => {
    it('updates _favorite_index for all reordered paths', async () => {
      const { result } = setup()

      await runAction(() => result.current.handleReorderFavorites(['/vault/a.md', '/vault/b.md', '/vault/c.md']))

      expectFrontmatterUpdate('/vault/a.md', '_favorite_index', 0, { silent: true })
      expectFrontmatterUpdate('/vault/b.md', '_favorite_index', 1, { silent: true })
      expectFrontmatterUpdate('/vault/c.md', '_favorite_index', 2, { silent: true })
      expectEntryUpdate('/vault/a.md', { favoriteIndex: 0 })
      expectEntryUpdate('/vault/b.md', { favoriteIndex: 1 })
      expectEntryUpdate('/vault/c.md', { favoriteIndex: 2 })
      expect(onFrontmatterPersisted).toHaveBeenCalledTimes(1)
    })
  })

  describe('onBeforeAction callback', () => {
    function setupWithBeforeAction(onBeforeAction: ReturnType<typeof vi.fn>) {
      return renderHook(() =>
        useEntryActions({
          entries: [], updateEntry, handleUpdateFrontmatter, handleDeleteProperty,
          setToastMessage, createTypeEntry, onFrontmatterPersisted, onBeforeAction,
        })
      )
    }

    it('calls onBeforeAction before archiving a note', async () => {
      const onBeforeAction = vi.fn().mockResolvedValue(undefined)
      const { result } = setupWithBeforeAction(onBeforeAction)

      await runAction(() => result.current.handleArchiveNote(NOTE_PATH))

      expect(onBeforeAction).toHaveBeenCalledWith(NOTE_PATH)
    })

    it('does not proceed with archiving when onBeforeAction rejects', async () => {
      const { result } = setupWithBeforeAction(vi.fn().mockRejectedValue(new Error('Save failed')))

      await expect(act(() => result.current.handleArchiveNote(NOTE_PATH))).rejects.toThrow('Save failed')

      expect(handleUpdateFrontmatter).not.toHaveBeenCalled()
    })
  })
})
