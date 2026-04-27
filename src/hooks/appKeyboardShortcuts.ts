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
  | 'onFindInNote'
  | 'onReplaceInNote'
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
  | 'onToggleRawEditor'
  | 'onToggleInspector'
  | 'onToggleFavorite'
  | 'onToggleOrganized'
  | 'onOpenInNewWindow'
  | 'activeTabPathRef'
  | 'multiSelectionCommandRef'
>

const TEXT_EDITING_KEYS = new Set(['Backspace', 'Delete'])
const TEXT_EDITING_BLOCKED_COMMANDS = new Set<AppCommandId>([
  APP_COMMAND_IDS.viewGoBack,
  APP_COMMAND_IDS.viewGoForward,
])

function isTextInputFocused(): boolean {
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return true
  return active.isContentEditable || active.closest('[contenteditable="true"]') !== null
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

  const textInputFocused = isTextInputFocused()
  if (textInputFocused) {
    if (TEXT_EDITING_KEYS.has(event.key)) return
    if (TEXT_EDITING_BLOCKED_COMMANDS.has(commandId)) {
      recordSuppressedShortcutCommand(commandId, 'renderer-keyboard')
      return
    }
  }

  event.preventDefault()
  if (commandId === APP_COMMAND_IDS.editFindInVault) {
    trackEvent('search_used')
  }
  executeAppCommand(commandId, actions, 'renderer-keyboard')
}
