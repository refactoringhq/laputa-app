import { trackEvent } from '../lib/telemetry'
import {
  APP_COMMAND_IDS,
  executeAppCommand,
  findShortcutCommandIdForEvent,
  recordSuppressedShortcutCommand,
  type AppCommandId,
  type AppCommandHandlers,
} from './appCommandDispatcher'

export type KeyboardActions = Pick<
  AppCommandHandlers,
  | 'onQuickOpen'
  | 'onCommandPalette'
  | 'onSearch'
  | 'onCreateNote'
  | 'onSave'
  | 'onUndo'
  | 'onRedo'
  | 'onFindInNote'
  | 'onReplaceInNote'
  | 'onPastePlainText'
  | 'onOpenSettings'
  | 'onDeleteNote'
  | 'onArchiveNote'
  | 'onSetViewMode'
  | 'onZoomIn'
  | 'onZoomOut'
  | 'onZoomReset'
  | 'onGoBack'
  | 'onGoForward'
  | 'onToggleAIChat'
  | 'onToggleTableOfContents'
  | 'onToggleRawEditor'
  | 'onToggleInspector'
  | 'onToggleFavorite'
  | 'onToggleOrganized'
  | 'onOpenInNewWindow'
  | 'activeTabPathRef'
  | 'multiSelectionCommandRef'
> & {
  canUndo?: boolean
  canRedo?: boolean
}

const TEXT_EDITING_KEYS = new Set(['Backspace', 'Delete'])
const TEXT_EDITING_BLOCKED_COMMANDS = new Set<AppCommandId>([
  APP_COMMAND_IDS.editUndo,
  APP_COMMAND_IDS.editRedo,
  APP_COMMAND_IDS.viewGoBack,
  APP_COMMAND_IDS.viewGoForward,
])

function isTextInputFocused(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return true
  return active.isContentEditable || active.closest('[contenteditable="true"]') !== null
}

function shouldFocusedTextOwnCommand(commandId: AppCommandId, key: string): boolean {
  return TEXT_EDITING_KEYS.has(key) || TEXT_EDITING_BLOCKED_COMMANDS.has(commandId)
}

function handleFocusedTextCommand(event: KeyboardEvent, commandId: AppCommandId): boolean {
  if (!isTextInputFocused()) return false
  if (!shouldFocusedTextOwnCommand(commandId, event.key)) return false
  recordSuppressedShortcutCommand(commandId, 'renderer-keyboard')
  return true
}

function isEditorFindScopeFocused(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  return active.closest('[data-editor-find-scope="true"]') !== null
}

export function handleAppKeyboardEvent(actions: KeyboardActions, event: KeyboardEvent) {
  const commandId = findShortcutCommandIdForEvent(event)
  if (commandId === null) return
  if (commandId === APP_COMMAND_IDS.editFindInNote && !isEditorFindScopeFocused()) return

  if (handleFocusedTextCommand(event, commandId)) return

  event.preventDefault()
  if (commandId === APP_COMMAND_IDS.editFindInVault) {
    trackEvent('search_used')
  }
  executeAppCommand(commandId, actions, 'renderer-keyboard')
}
