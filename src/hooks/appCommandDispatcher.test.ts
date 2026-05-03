import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_COMMAND_IDS,
  dispatchAppCommand,
  executeAppCommand,
  findShortcutCommandId,
  findShortcutCommandIdForEvent,
  isAppCommandId,
  isNativeMenuCommandId,
  recordSuppressedShortcutCommand,
  resetAppCommandDispatchStateForTests,
  type AppCommandHandlers,
} from './appCommandDispatcher'
import {
  getDeterministicShortcutQaDefinition,
  APP_COMMAND_MENU_SECTIONS,
  APP_COMMAND_MENU_STATE_GROUPS,
  getShortcutEventInit,
} from './appCommandCatalog'

const originalUserAgent = navigator.userAgent

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
}

function makeHandlers(): AppCommandHandlers {
  return {
    onSetViewMode: vi.fn(),
    onCreateNote: vi.fn(),
    onCreateType: vi.fn(),
    onQuickOpen: vi.fn(),
    onSave: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleInspector: vi.fn(),
    onCommandPalette: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onToggleOrganized: vi.fn(),
    onToggleFavorite: vi.fn(),
    onArchiveNote: vi.fn(),
    onDeleteNote: vi.fn(),
    onSearch: vi.fn(),
    onToggleRawEditor: vi.fn(),
    onToggleDiff: vi.fn(),
    onToggleAIChat: vi.fn(),
    onPastePlainText: vi.fn(),
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onSelectFilter: vi.fn(),
    onOpenVault: vi.fn(),
    onRemoveActiveVault: vi.fn(),
    onRestoreGettingStarted: vi.fn(),
    onCommitPush: vi.fn(),
    onPull: vi.fn(),
    onResolveConflicts: vi.fn(),
    onViewChanges: vi.fn(),
    onInstallMcp: vi.fn(),
    onOpenInNewWindow: vi.fn(),
    onReloadVault: vi.fn(),
    onRepairVault: vi.fn(),
    onRestoreDeletedNote: vi.fn(),
    activeTabPathRef: { current: '/vault/test.md' },
    multiSelectionCommandRef: { current: null },
  }
}

function expectShortcutEventCommand(
  event: Partial<KeyboardEvent> & Pick<KeyboardEvent, 'key' | 'code'>,
  commandId: string | null,
) {
  expect(
    findShortcutCommandIdForEvent({
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...event,
    }),
  ).toBe(commandId)
}

describe('appCommandDispatcher', () => {
  afterEach(() => {
    setUserAgent(originalUserAgent)
    resetAppCommandDispatchStateForTests()
  })

  it('recognizes valid command ids', () => {
    expect(isAppCommandId(APP_COMMAND_IDS.fileNewNote)).toBe(true)
    expect(isAppCommandId('not-a-command')).toBe(false)
  })

  it('no longer recognizes the removed daily-note menu id', () => {
    expect(isAppCommandId('file-daily-note')).toBe(false)
  })

  it('distinguishes native menu ids from keyboard-only ids', () => {
    expect(isNativeMenuCommandId(APP_COMMAND_IDS.fileNewNote)).toBe(true)
    expect(isNativeMenuCommandId(APP_COMMAND_IDS.noteToggleFavorite)).toBe(false)
  })

  it('derives native menu command IDs from the shared command menu manifest', () => {
    const menuCommandIds = APP_COMMAND_MENU_SECTIONS.flatMap(section =>
      section.items.flatMap(item => item.kind === 'command' ? [item.commandId] : []),
    )

    expect(menuCommandIds).toContain(APP_COMMAND_IDS.fileNewNote)
    expect(menuCommandIds).toContain(APP_COMMAND_IDS.editPastePlainText)
    expect(menuCommandIds).toContain(APP_COMMAND_IDS.viewGoBack)
    expect(menuCommandIds).not.toContain(APP_COMMAND_IDS.noteToggleFavorite)
  })

  it('keeps native menu state groups inside the shared command menu manifest', () => {
    const menuCommandIds = new Set(
      APP_COMMAND_MENU_SECTIONS.flatMap(section =>
        section.items.flatMap(item => item.kind === 'command' ? [item.menuItemId] : []),
      ),
    )

    for (const commandIds of Object.values(APP_COMMAND_MENU_STATE_GROUPS)) {
      for (const commandId of commandIds) {
        expect(menuCommandIds.has(commandId)).toBe(true)
      }
    }
  })

  it('finds raw editor, AI, and plain-text paste shortcuts from the shared catalog', () => {
    expect(findShortcutCommandId('command-or-ctrl', 'o', 'KeyO')).toBe(APP_COMMAND_IDS.fileQuickOpen)
    expect(findShortcutCommandId('command-or-ctrl', '\\')).toBe(APP_COMMAND_IDS.editToggleRawEditor)
    expect(findShortcutCommandId('command-or-ctrl-shift', '¬', 'KeyL')).toBe(APP_COMMAND_IDS.viewToggleAiChat)
    expect(findShortcutCommandId('command-or-ctrl-shift', 'v', 'KeyV')).toBe(APP_COMMAND_IDS.editPastePlainText)
  })

  it('gives every shortcut command an explicit deterministic QA strategy', () => {
    expect(getDeterministicShortcutQaDefinition(APP_COMMAND_IDS.fileNewNote)).toMatchObject({
      preferredMode: 'native-menu-command',
      supportsRendererShortcutEvent: true,
      supportsNativeMenuCommand: true,
      requiresManualNativeAcceleratorQa: true,
    })
    expect(getDeterministicShortcutQaDefinition(APP_COMMAND_IDS.viewToggleProperties)).toMatchObject({
      preferredMode: 'renderer-shortcut-event',
      supportsRendererShortcutEvent: true,
      supportsNativeMenuCommand: true,
      requiresManualNativeAcceleratorQa: false,
    })
    expect(getDeterministicShortcutQaDefinition(APP_COMMAND_IDS.noteToggleFavorite)).toMatchObject({
      preferredMode: 'renderer-shortcut-event',
      supportsRendererShortcutEvent: true,
      supportsNativeMenuCommand: false,
      requiresManualNativeAcceleratorQa: true,
    })
    expect(getDeterministicShortcutQaDefinition(APP_COMMAND_IDS.editPastePlainText)).toMatchObject({
      preferredMode: 'native-menu-command',
      supportsRendererShortcutEvent: true,
      supportsNativeMenuCommand: true,
      requiresManualNativeAcceleratorQa: true,
    })
  })

  it('builds deterministic keyboard events from the shared shortcut manifest', () => {
    expect(getShortcutEventInit(APP_COMMAND_IDS.viewToggleAiChat)).toMatchObject({
      key: 'l',
      code: 'KeyL',
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
    })
    expect(getShortcutEventInit(APP_COMMAND_IDS.viewToggleAiChat, { preferControl: true })).toMatchObject({
      key: 'l',
      code: 'KeyL',
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
    })
    expect(getShortcutEventInit(APP_COMMAND_IDS.viewGoBack)).toMatchObject({
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
    })
    expect(getShortcutEventInit(APP_COMMAND_IDS.appCheckForUpdates)).toBeNull()
  })

  it('resolves event modifiers through the shared shortcut catalog', () => {
    expectShortcutEventCommand({ key: 'o', code: 'KeyO', metaKey: true }, APP_COMMAND_IDS.fileQuickOpen)
    expectShortcutEventCommand({ key: '¬', code: 'KeyL', metaKey: true, shiftKey: true }, APP_COMMAND_IDS.viewToggleAiChat)
    expectShortcutEventCommand({ key: 'I', code: 'KeyI', metaKey: true, shiftKey: true }, APP_COMMAND_IDS.viewToggleProperties)
    expectShortcutEventCommand({ key: 'ArrowLeft', code: 'ArrowLeft', metaKey: true }, APP_COMMAND_IDS.viewGoBack)
    expectShortcutEventCommand({ key: 'ArrowRight', code: 'ArrowRight', metaKey: true }, APP_COMMAND_IDS.viewGoForward)
    expectShortcutEventCommand({ key: 'l', code: 'KeyL', ctrlKey: true, shiftKey: true }, APP_COMMAND_IDS.viewToggleAiChat)
    expectShortcutEventCommand({ key: 'V', code: 'KeyV', metaKey: true, shiftKey: true }, APP_COMMAND_IDS.editPastePlainText)
  })

  it('ignores macOS Control-only shortcuts so native text editing bindings pass through', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')

    expectShortcutEventCommand({ key: 'e', code: 'KeyE', ctrlKey: true }, null)
    expectShortcutEventCommand({ key: 'n', code: 'KeyN', ctrlKey: true }, null)
    expectShortcutEventCommand({ key: 'p', code: 'KeyP', ctrlKey: true }, null)
    expectShortcutEventCommand({ key: 'd', code: 'KeyD', ctrlKey: true }, null)
    expectShortcutEventCommand({ key: 'e', code: 'KeyE', metaKey: true }, APP_COMMAND_IDS.noteToggleOrganized)
  })

  it('dispatches create note through the shared command path', () => {
    const handlers = makeHandlers()
    expect(dispatchAppCommand(APP_COMMAND_IDS.fileNewNote, handlers)).toBe(true)
    expect(handlers.onCreateNote).toHaveBeenCalled()
  })

  it('dispatches inspector toggle through the shared command path', () => {
    const handlers = makeHandlers()
    expect(dispatchAppCommand(APP_COMMAND_IDS.viewToggleProperties, handlers)).toBe(true)
    expect(handlers.onToggleInspector).toHaveBeenCalled()
  })

  it('dispatches AI panel toggle through the shared command path', () => {
    const handlers = makeHandlers()
    expect(dispatchAppCommand(APP_COMMAND_IDS.viewToggleAiChat, handlers)).toBe(true)
    expect(handlers.onToggleAIChat).toHaveBeenCalled()
  })

  it('dispatches plain-text paste through the shared command path', () => {
    const handlers = makeHandlers()
    expect(dispatchAppCommand(APP_COMMAND_IDS.editPastePlainText, handlers)).toBe(true)
    expect(handlers.onPastePlainText).toHaveBeenCalled()
  })

  it('uses the active note for note-scoped commands', () => {
    const handlers = makeHandlers()
    expect(dispatchAppCommand(APP_COMMAND_IDS.noteToggleFavorite, handlers)).toBe(true)
    expect(dispatchAppCommand(APP_COMMAND_IDS.noteToggleOrganized, handlers)).toBe(true)
    expect(dispatchAppCommand(APP_COMMAND_IDS.noteDelete, handlers)).toBe(true)
    expect(handlers.onToggleFavorite).toHaveBeenCalledWith('/vault/test.md')
    expect(handlers.onToggleOrganized).toHaveBeenCalledWith('/vault/test.md')
    expect(handlers.onDeleteNote).toHaveBeenCalledWith('/vault/test.md')
  })

  it('uses the current multi-selection for delete and organize commands', () => {
    const handlers = makeHandlers()
    const deleteSelected = vi.fn()
    const organizeSelected = vi.fn()
    handlers.multiSelectionCommandRef.current = {
      selectedPaths: ['/vault/a.md', '/vault/b.md'],
      deleteSelected,
      organizeSelected,
    }

    expect(dispatchAppCommand(APP_COMMAND_IDS.noteToggleOrganized, handlers)).toBe(true)
    expect(dispatchAppCommand(APP_COMMAND_IDS.noteDelete, handlers)).toBe(true)

    expect(organizeSelected).toHaveBeenCalledTimes(1)
    expect(deleteSelected).toHaveBeenCalledTimes(1)
    expect(handlers.onToggleOrganized).not.toHaveBeenCalled()
    expect(handlers.onDeleteNote).not.toHaveBeenCalled()
  })

  it('does not fall back to the active note when multi-selection cannot handle the command', () => {
    const handlers = makeHandlers()
    handlers.multiSelectionCommandRef.current = {
      selectedPaths: ['/vault/a.md', '/vault/b.md'],
    }

    expect(dispatchAppCommand(APP_COMMAND_IDS.noteToggleOrganized, handlers)).toBe(false)
    expect(handlers.onToggleOrganized).not.toHaveBeenCalled()
  })

  it('no-ops note-scoped commands when there is no active note', () => {
    const handlers = makeHandlers()
    handlers.activeTabPathRef.current = null
    expect(dispatchAppCommand(APP_COMMAND_IDS.noteToggleFavorite, handlers)).toBe(false)
    expect(dispatchAppCommand(APP_COMMAND_IDS.noteToggleOrganized, handlers)).toBe(false)
    expect(dispatchAppCommand(APP_COMMAND_IDS.noteDelete, handlers)).toBe(false)
    expect(handlers.onToggleFavorite).not.toHaveBeenCalled()
    expect(handlers.onToggleOrganized).not.toHaveBeenCalled()
    expect(handlers.onDeleteNote).not.toHaveBeenCalled()
  })

  it('dispatches navigation filters through the same shared command path', () => {
    const handlers = makeHandlers()
    expect(dispatchAppCommand(APP_COMMAND_IDS.goChanges, handlers)).toBe(true)
    expect(handlers.onSelectFilter).toHaveBeenCalledWith('changes')
  })

  it('suppresses a native-menu echo after renderer keyboard dispatch', () => {
    const handlers = makeHandlers()

    expect(executeAppCommand(APP_COMMAND_IDS.viewToggleProperties, handlers, 'renderer-keyboard')).toBe(true)
    expect(executeAppCommand(APP_COMMAND_IDS.viewToggleProperties, handlers, 'native-menu')).toBe(false)
    expect(handlers.onToggleInspector).toHaveBeenCalledTimes(1)
  })

  it('suppresses a renderer keyboard echo after native-menu dispatch', () => {
    const handlers = makeHandlers()

    expect(executeAppCommand(APP_COMMAND_IDS.viewToggleAiChat, handlers, 'native-menu')).toBe(true)
    expect(executeAppCommand(APP_COMMAND_IDS.viewToggleAiChat, handlers, 'renderer-keyboard')).toBe(false)
    expect(handlers.onToggleAIChat).toHaveBeenCalledTimes(1)
  })

  it('suppresses a native-menu history echo after renderer keyboard yields to text editing', () => {
    const handlers = makeHandlers()

    recordSuppressedShortcutCommand(APP_COMMAND_IDS.viewGoBack)

    expect(executeAppCommand(APP_COMMAND_IDS.viewGoBack, handlers, 'native-menu')).toBe(false)
    expect(handlers.onGoBack).not.toHaveBeenCalled()
  })
})
