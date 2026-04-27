import type { MutableRefObject } from 'react'
import type { SidebarFilter } from '../types'
import {
  APP_COMMAND_DEFINITIONS,
  type AppCommandId,
  type AppCommandDefinition,
} from './appCommandCatalog'
import type { ViewMode } from './useViewMode'
import type { NoteListMultiSelectionCommands } from '../components/note-list/multiSelectionCommands'

export const APP_COMMAND_EVENT_NAME = 'laputa:dispatch-command'

export {
  APP_COMMAND_IDS,
  findShortcutCommandId,
  findShortcutCommandIdForEvent,
  isAppCommandId,
  isNativeMenuCommandId,
} from './appCommandCatalog'
export type { AppCommandDefinition, AppCommandId, AppCommandShortcutCombo } from './appCommandCatalog'

export type AppCommandDispatchSource =
  | 'direct'
  | 'renderer-keyboard'
  | 'native-menu'
  | 'app-event'

type SuppressedShortcutSource = Extract<AppCommandDispatchSource, 'renderer-keyboard'>

export interface AppCommandHandlers {
  onSetViewMode: (mode: ViewMode) => void
  onCreateNote: () => void
  onCreateType?: () => void
  onQuickOpen: () => void
  onSave: () => void
  onOpenSettings: () => void
  onToggleInspector: () => void
  onCommandPalette: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onToggleOrganized?: (path: string) => void
  onToggleFavorite?: (path: string) => void
  onArchiveNote: (path: string) => void
  onDeleteNote: (path: string) => void
  onFindInNote?: () => void
  onReplaceInNote?: () => void
  onSearch: () => void
  onToggleRawEditor?: () => void
  onToggleDiff?: () => void
  onToggleAIChat?: () => void
  onGoBack?: () => void
  onGoForward?: () => void
  onCheckForUpdates?: () => void
  onSelectFilter?: (filter: SidebarFilter) => void
  onOpenVault?: () => void
  onRemoveActiveVault?: () => void
  onRestoreGettingStarted?: () => void
  onAddRemote?: () => void
  onCommitPush?: () => void
  onPull?: () => void
  onResolveConflicts?: () => void
  onViewChanges?: () => void
  onInstallMcp?: () => void
  onOpenInNewWindow?: () => void
  onReloadVault?: () => void
  onRepairVault?: () => void
  onRestoreDeletedNote?: () => void
  activeTabPathRef: MutableRefObject<string | null>
  multiSelectionCommandRef?: MutableRefObject<NoteListMultiSelectionCommands | null>
}

type SimpleHandlerKey = keyof Pick<
  AppCommandHandlers,
  | 'onOpenSettings'
  | 'onCheckForUpdates'
  | 'onCreateNote'
  | 'onCreateType'
  | 'onQuickOpen'
  | 'onSave'
  | 'onFindInNote'
  | 'onReplaceInNote'
  | 'onSearch'
  | 'onToggleRawEditor'
  | 'onToggleDiff'
  | 'onToggleInspector'
  | 'onToggleAIChat'
  | 'onCommandPalette'
  | 'onZoomIn'
  | 'onZoomOut'
  | 'onZoomReset'
  | 'onGoBack'
  | 'onGoForward'
  | 'onOpenVault'
  | 'onRemoveActiveVault'
  | 'onRestoreGettingStarted'
  | 'onAddRemote'
  | 'onCommitPush'
  | 'onPull'
  | 'onResolveConflicts'
  | 'onViewChanges'
  | 'onInstallMcp'
  | 'onReloadVault'
  | 'onRepairVault'
  | 'onOpenInNewWindow'
  | 'onRestoreDeletedNote'
>

type ActiveTabHandlerKey = keyof Pick<
  AppCommandHandlers,
  'onToggleOrganized' | 'onToggleFavorite' | 'onArchiveNote' | 'onDeleteNote'
>

const SIMPLE_HANDLER_EXECUTORS: Record<SimpleHandlerKey, (handlers: AppCommandHandlers) => void> = {
  onOpenSettings: (handlers) => handlers.onOpenSettings(),
  onCheckForUpdates: (handlers) => handlers.onCheckForUpdates?.(),
  onCreateNote: (handlers) => handlers.onCreateNote(),
  onCreateType: (handlers) => handlers.onCreateType?.(),
  onQuickOpen: (handlers) => handlers.onQuickOpen(),
  onSave: (handlers) => handlers.onSave(),
  onFindInNote: (handlers) => handlers.onFindInNote?.(),
  onReplaceInNote: (handlers) => handlers.onReplaceInNote?.(),
  onSearch: (handlers) => handlers.onSearch(),
  onToggleRawEditor: (handlers) => handlers.onToggleRawEditor?.(),
  onToggleDiff: (handlers) => handlers.onToggleDiff?.(),
  onToggleInspector: (handlers) => handlers.onToggleInspector(),
  onToggleAIChat: (handlers) => handlers.onToggleAIChat?.(),
  onCommandPalette: (handlers) => handlers.onCommandPalette(),
  onZoomIn: (handlers) => handlers.onZoomIn(),
  onZoomOut: (handlers) => handlers.onZoomOut(),
  onZoomReset: (handlers) => handlers.onZoomReset(),
  onGoBack: (handlers) => handlers.onGoBack?.(),
  onGoForward: (handlers) => handlers.onGoForward?.(),
  onOpenVault: (handlers) => handlers.onOpenVault?.(),
  onRemoveActiveVault: (handlers) => handlers.onRemoveActiveVault?.(),
  onRestoreGettingStarted: (handlers) => handlers.onRestoreGettingStarted?.(),
  onAddRemote: (handlers) => handlers.onAddRemote?.(),
  onCommitPush: (handlers) => handlers.onCommitPush?.(),
  onPull: (handlers) => handlers.onPull?.(),
  onResolveConflicts: (handlers) => handlers.onResolveConflicts?.(),
  onViewChanges: (handlers) => handlers.onViewChanges?.(),
  onInstallMcp: (handlers) => handlers.onInstallMcp?.(),
  onReloadVault: (handlers) => handlers.onReloadVault?.(),
  onRepairVault: (handlers) => handlers.onRepairVault?.(),
  onOpenInNewWindow: (handlers) => handlers.onOpenInNewWindow?.(),
  onRestoreDeletedNote: (handlers) => handlers.onRestoreDeletedNote?.(),
}

const ACTIVE_TAB_HANDLER_EXECUTORS: Record<ActiveTabHandlerKey, (handlers: AppCommandHandlers, path: string) => void> = {
  onToggleOrganized: (handlers, path) => handlers.onToggleOrganized?.(path),
  onToggleFavorite: (handlers, path) => handlers.onToggleFavorite?.(path),
  onArchiveNote: (handlers, path) => handlers.onArchiveNote(path),
  onDeleteNote: (handlers, path) => handlers.onDeleteNote(path),
}

const SHORTCUT_ECHO_DEDUPE_WINDOW_MS = 150
let lastCommandDispatch:
  | {
      id: AppCommandId
      source: AppCommandDispatchSource
      timestamp: number
    }
  | null = null

let lastSuppressedShortcutCommand:
  | {
      id: AppCommandId
      source: SuppressedShortcutSource
      timestamp: number
    }
  | null = null

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function isShortcutEchoPair(a: AppCommandDispatchSource, b: AppCommandDispatchSource): boolean {
  return (
    (a === 'renderer-keyboard' && b === 'native-menu') ||
    (a === 'native-menu' && b === 'renderer-keyboard')
  )
}

function shouldSuppressDuplicateCommand(
  id: AppCommandId,
  source: AppCommandDispatchSource,
  currentTimestamp: number,
): boolean {
  if (!lastCommandDispatch || lastCommandDispatch.id !== id) return false
  if (!isShortcutEchoPair(source, lastCommandDispatch.source)) return false
  return currentTimestamp - lastCommandDispatch.timestamp <= SHORTCUT_ECHO_DEDUPE_WINDOW_MS
}

function shouldSuppressShortcutEchoAfterKeyboardYield(
  id: AppCommandId,
  source: AppCommandDispatchSource,
  currentTimestamp: number,
): boolean {
  if (source !== 'native-menu') return false
  if (!lastSuppressedShortcutCommand || lastSuppressedShortcutCommand.id !== id) return false
  return currentTimestamp - lastSuppressedShortcutCommand.timestamp <= SHORTCUT_ECHO_DEDUPE_WINDOW_MS
}

function dispatchActiveTabCommand(
  pathRef: MutableRefObject<string | null>,
  handler: (path: string) => void,
): boolean {
  const path = pathRef.current
  if (!path) return false
  handler(path)
  return true
}

function dispatchMultiSelectionCommand(
  selectionRef: MutableRefObject<NoteListMultiSelectionCommands | null> | undefined,
  handler: ActiveTabHandlerKey,
): boolean | null {
  const selection = selectionRef?.current
  if (!selection || selection.selectedPaths.length <= 1) return null

  if (handler === 'onDeleteNote') {
    selection.deleteSelected?.()
    return !!selection.deleteSelected
  }

  if (handler === 'onToggleOrganized') {
    selection.organizeSelected?.()
    return !!selection.organizeSelected
  }

  return false
}

function dispatchDefinition(
  definition: AppCommandDefinition,
  handlers: AppCommandHandlers,
): boolean {
  switch (definition.route.kind) {
    case 'view-mode':
      handlers.onSetViewMode(definition.route.value)
      return true
    case 'filter':
      handlers.onSelectFilter?.(definition.route.value)
      return true
    case 'handler': {
      const handler = definition.route.handler
      SIMPLE_HANDLER_EXECUTORS[handler as SimpleHandlerKey](handlers)
      return true
    }
    case 'active-tab-handler': {
      const handler = definition.route.handler
      const multiSelectionResult = dispatchMultiSelectionCommand(
        handlers.multiSelectionCommandRef,
        handler as ActiveTabHandlerKey,
      )
      if (multiSelectionResult !== null) {
        return multiSelectionResult
      }

      return dispatchActiveTabCommand(
        handlers.activeTabPathRef,
        (path) => ACTIVE_TAB_HANDLER_EXECUTORS[handler as ActiveTabHandlerKey](handlers, path),
      )
    }
  }
}

export function dispatchAppCommand(id: AppCommandId, handlers: AppCommandHandlers): boolean {
  return executeAppCommand(id, handlers, 'direct')
}

export function executeAppCommand(
  id: AppCommandId,
  handlers: AppCommandHandlers,
  source: AppCommandDispatchSource,
): boolean {
  const timestamp = now()
  if (shouldSuppressShortcutEchoAfterKeyboardYield(id, source, timestamp)) {
    return false
  }
  if (shouldSuppressDuplicateCommand(id, source, timestamp)) {
    return false
  }

  const dispatched = dispatchDefinition(APP_COMMAND_DEFINITIONS[id], handlers)
  if (dispatched) {
    lastCommandDispatch = { id, source, timestamp }
  }
  return dispatched
}

export function recordSuppressedShortcutCommand(
  id: AppCommandId,
  source: SuppressedShortcutSource = 'renderer-keyboard',
): void {
  lastSuppressedShortcutCommand = { id, source, timestamp: now() }
}

export function resetAppCommandDispatchStateForTests(): void {
  lastCommandDispatch = null
  lastSuppressedShortcutCommand = null
}
