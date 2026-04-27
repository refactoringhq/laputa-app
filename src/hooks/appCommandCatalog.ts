import type { SidebarFilter } from '../types'
import { isMac } from '../utils/platform'
import type { ViewMode } from './useViewMode'

export const APP_COMMAND_IDS = {
  appSettings: 'app-settings',
  appCheckForUpdates: 'app-check-for-updates',
  fileNewNote: 'file-new-note',
  fileNewType: 'file-new-type',
  fileQuickOpen: 'file-quick-open',
  fileSave: 'file-save',
  editFindInNote: 'edit-find-in-note',
  editReplaceInNote: 'edit-replace-in-note',
  editFindInVault: 'edit-find-in-vault',
  editToggleRawEditor: 'edit-toggle-raw-editor',
  editToggleDiff: 'edit-toggle-diff',
  viewEditorOnly: 'view-editor-only',
  viewEditorList: 'view-editor-list',
  viewAll: 'view-all',
  viewToggleProperties: 'view-toggle-properties',
  viewToggleAiChat: 'view-toggle-ai-chat',
  viewToggleBacklinks: 'view-toggle-backlinks',
  viewCommandPalette: 'view-command-palette',
  viewZoomIn: 'view-zoom-in',
  viewZoomOut: 'view-zoom-out',
  viewZoomReset: 'view-zoom-reset',
  viewGoBack: 'view-go-back',
  viewGoForward: 'view-go-forward',
  goAllNotes: 'go-all-notes',
  goArchived: 'go-archived',
  goChanges: 'go-changes',
  goInbox: 'go-inbox',
  noteToggleOrganized: 'note-toggle-organized',
  noteToggleFavorite: 'note-toggle-favorite',
  noteArchive: 'note-archive',
  noteDelete: 'note-delete',
  noteOpenInNewWindow: 'note-open-in-new-window',
  noteRestoreDeleted: 'note-restore-deleted',
  vaultOpen: 'vault-open',
  vaultRemove: 'vault-remove',
  vaultRestoreGettingStarted: 'vault-restore-getting-started',
  vaultAddRemote: 'vault-add-remote',
  vaultCommitPush: 'vault-commit-push',
  vaultPull: 'vault-pull',
  vaultResolveConflicts: 'vault-resolve-conflicts',
  vaultViewChanges: 'vault-view-changes',
  vaultInstallMcp: 'vault-install-mcp',
  vaultReload: 'vault-reload',
  vaultRepair: 'vault-repair',
} as const

export type AppCommandId = (typeof APP_COMMAND_IDS)[keyof typeof APP_COMMAND_IDS]
export type AppCommandShortcutCombo =
  | 'command-or-ctrl'
  | 'command-or-ctrl-shift'
  | 'command-shift'
export type AppCommandDeterministicQaMode =
  | 'renderer-shortcut-event'
  | 'native-menu-command'
type ShortcutEventLike = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key' | 'code'>

export interface AppCommandDeterministicQaDefinition {
  preferredMode: AppCommandDeterministicQaMode
  supportsRendererShortcutEvent: boolean
  supportsNativeMenuCommand: boolean
  requiresManualNativeAcceleratorQa: boolean
}

export interface AppCommandShortcutEventOptions {
  preferControl?: boolean
}

export type AppCommandShortcutEventInit = Pick<
  KeyboardEventInit,
  'altKey' | 'bubbles' | 'cancelable' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
>

type SimpleHandlerKey =
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

type ActiveTabHandlerKey =
  | 'onToggleOrganized'
  | 'onToggleFavorite'
  | 'onArchiveNote'
  | 'onDeleteNote'

type AppCommandRoute =
  | { kind: 'view-mode'; value: ViewMode }
  | { kind: 'filter'; value: SidebarFilter }
  | { kind: 'handler'; handler: SimpleHandlerKey }
  | { kind: 'active-tab-handler'; handler: ActiveTabHandlerKey }

interface AppCommandShortcutDefinition {
  combo: AppCommandShortcutCombo
  key: string
  aliases?: string[]
  code?: string
  display: string
}

export interface AppCommandDefinition {
  route: AppCommandRoute
  menuOwned: boolean
  shortcut?: AppCommandShortcutDefinition
  preferredShortcutQaMode?: AppCommandDeterministicQaMode
}

export const APP_COMMAND_DEFINITIONS: Record<AppCommandId, AppCommandDefinition> = {
  [APP_COMMAND_IDS.appSettings]: {
    route: { kind: 'handler', handler: 'onOpenSettings' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: ',', display: '⌘,' },
  },
  [APP_COMMAND_IDS.appCheckForUpdates]: {
    route: { kind: 'handler', handler: 'onCheckForUpdates' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.fileNewNote]: {
    route: { kind: 'handler', handler: 'onCreateNote' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: 'n', code: 'KeyN', display: '⌘N' },
  },
  [APP_COMMAND_IDS.fileNewType]: {
    route: { kind: 'handler', handler: 'onCreateType' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.fileQuickOpen]: {
    route: { kind: 'handler', handler: 'onQuickOpen' },
    menuOwned: true,
    shortcut: {
      combo: 'command-or-ctrl',
      key: 'p',
      aliases: ['o'],
      code: 'KeyP',
      display: '⌘P / ⌘O',
    },
  },
  [APP_COMMAND_IDS.fileSave]: {
    route: { kind: 'handler', handler: 'onSave' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: 's', code: 'KeyS', display: '⌘S' },
  },
  [APP_COMMAND_IDS.editFindInNote]: {
    route: { kind: 'handler', handler: 'onFindInNote' },
    menuOwned: true,
    preferredShortcutQaMode: 'renderer-shortcut-event',
    shortcut: { combo: 'command-or-ctrl', key: 'f', code: 'KeyF', display: '⌘F' },
  },
  [APP_COMMAND_IDS.editReplaceInNote]: {
    route: { kind: 'handler', handler: 'onReplaceInNote' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.editFindInVault]: {
    route: { kind: 'handler', handler: 'onSearch' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl-shift', key: 'f', code: 'KeyF', display: '⌘⇧F' },
  },
  [APP_COMMAND_IDS.editToggleRawEditor]: {
    route: { kind: 'handler', handler: 'onToggleRawEditor' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: '\\', display: '⌘\\' },
  },
  [APP_COMMAND_IDS.editToggleDiff]: {
    route: { kind: 'handler', handler: 'onToggleDiff' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.viewEditorOnly]: {
    route: { kind: 'view-mode', value: 'editor-only' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: '1', display: '⌘1' },
  },
  [APP_COMMAND_IDS.viewEditorList]: {
    route: { kind: 'view-mode', value: 'editor-list' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: '2', display: '⌘2' },
  },
  [APP_COMMAND_IDS.viewAll]: {
    route: { kind: 'view-mode', value: 'all' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: '3', display: '⌘3' },
  },
  [APP_COMMAND_IDS.viewToggleProperties]: {
    route: { kind: 'handler', handler: 'onToggleInspector' },
    menuOwned: true,
    preferredShortcutQaMode: 'renderer-shortcut-event',
    shortcut: { combo: 'command-or-ctrl-shift', key: 'i', code: 'KeyI', display: '⌘⇧I' },
  },
  [APP_COMMAND_IDS.viewToggleAiChat]: {
    route: { kind: 'handler', handler: 'onToggleAIChat' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl-shift', key: 'l', code: 'KeyL', display: '⌘⇧L' },
  },
  [APP_COMMAND_IDS.viewToggleBacklinks]: {
    route: { kind: 'handler', handler: 'onToggleInspector' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.viewCommandPalette]: {
    route: { kind: 'handler', handler: 'onCommandPalette' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: 'k', code: 'KeyK', display: '⌘K' },
  },
  [APP_COMMAND_IDS.viewZoomIn]: {
    route: { kind: 'handler', handler: 'onZoomIn' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: '=', aliases: ['+'], display: '⌘=' },
  },
  [APP_COMMAND_IDS.viewZoomOut]: {
    route: { kind: 'handler', handler: 'onZoomOut' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: '-', display: '⌘-' },
  },
  [APP_COMMAND_IDS.viewZoomReset]: {
    route: { kind: 'handler', handler: 'onZoomReset' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: '0', display: '⌘0' },
  },
  [APP_COMMAND_IDS.viewGoBack]: {
    route: { kind: 'handler', handler: 'onGoBack' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: 'ArrowLeft', code: 'ArrowLeft', display: '⌘←' },
  },
  [APP_COMMAND_IDS.viewGoForward]: {
    route: { kind: 'handler', handler: 'onGoForward' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: 'ArrowRight', code: 'ArrowRight', display: '⌘→' },
  },
  [APP_COMMAND_IDS.goAllNotes]: {
    route: { kind: 'filter', value: 'all' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.goArchived]: {
    route: { kind: 'filter', value: 'archived' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.goChanges]: {
    route: { kind: 'filter', value: 'changes' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.goInbox]: {
    route: { kind: 'filter', value: 'inbox' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.noteToggleOrganized]: {
    route: { kind: 'active-tab-handler', handler: 'onToggleOrganized' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: 'e', code: 'KeyE', display: '⌘E' },
  },
  [APP_COMMAND_IDS.noteToggleFavorite]: {
    route: { kind: 'active-tab-handler', handler: 'onToggleFavorite' },
    menuOwned: false,
    shortcut: { combo: 'command-or-ctrl', key: 'd', code: 'KeyD', display: '⌘D' },
  },
  [APP_COMMAND_IDS.noteArchive]: {
    route: { kind: 'active-tab-handler', handler: 'onArchiveNote' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.noteDelete]: {
    route: { kind: 'active-tab-handler', handler: 'onDeleteNote' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl', key: 'Backspace', aliases: ['Delete'], display: '⌘⌫' },
  },
  [APP_COMMAND_IDS.noteOpenInNewWindow]: {
    route: { kind: 'handler', handler: 'onOpenInNewWindow' },
    menuOwned: true,
    shortcut: { combo: 'command-or-ctrl-shift', key: 'o', code: 'KeyO', display: '⌘⇧O' },
  },
  [APP_COMMAND_IDS.noteRestoreDeleted]: {
    route: { kind: 'handler', handler: 'onRestoreDeletedNote' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultOpen]: {
    route: { kind: 'handler', handler: 'onOpenVault' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultRemove]: {
    route: { kind: 'handler', handler: 'onRemoveActiveVault' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultRestoreGettingStarted]: {
    route: { kind: 'handler', handler: 'onRestoreGettingStarted' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultAddRemote]: {
    route: { kind: 'handler', handler: 'onAddRemote' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultCommitPush]: {
    route: { kind: 'handler', handler: 'onCommitPush' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultPull]: {
    route: { kind: 'handler', handler: 'onPull' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultResolveConflicts]: {
    route: { kind: 'handler', handler: 'onResolveConflicts' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultViewChanges]: {
    route: { kind: 'handler', handler: 'onViewChanges' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultInstallMcp]: {
    route: { kind: 'handler', handler: 'onInstallMcp' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultReload]: {
    route: { kind: 'handler', handler: 'onReloadVault' },
    menuOwned: true,
  },
  [APP_COMMAND_IDS.vaultRepair]: {
    route: { kind: 'handler', handler: 'onRepairVault' },
    menuOwned: true,
  },
}

const APP_COMMAND_SET = new Set<string>(Object.values(APP_COMMAND_IDS))

const NATIVE_MENU_COMMAND_SET = new Set<string>(
  (Object.entries(APP_COMMAND_DEFINITIONS) as Array<[AppCommandId, AppCommandDefinition]>)
    .filter(([, definition]) => definition.menuOwned)
    .map(([id]) => id),
)

const MANUAL_NATIVE_ACCELERATOR_QA_COMMAND_SET = new Set<AppCommandId>([
  APP_COMMAND_IDS.appSettings,
  APP_COMMAND_IDS.fileNewNote,
  APP_COMMAND_IDS.fileQuickOpen,
  APP_COMMAND_IDS.fileSave,
  APP_COMMAND_IDS.editFindInNote,
  APP_COMMAND_IDS.editFindInVault,
  APP_COMMAND_IDS.viewToggleAiChat,
  APP_COMMAND_IDS.viewCommandPalette,
  APP_COMMAND_IDS.noteToggleOrganized,
  APP_COMMAND_IDS.noteToggleFavorite,
])

const shortcutKeyMaps = {
  'command-or-ctrl': new Map<string, AppCommandId>(),
  'command-or-ctrl-shift': new Map<string, AppCommandId>(),
  'command-shift': new Map<string, AppCommandId>(),
} satisfies Record<AppCommandShortcutCombo, Map<string, AppCommandId>>

const shortcutCodeMaps = {
  'command-or-ctrl': new Map<string, AppCommandId>(),
  'command-or-ctrl-shift': new Map<string, AppCommandId>(),
  'command-shift': new Map<string, AppCommandId>(),
} satisfies Record<AppCommandShortcutCombo, Map<string, AppCommandId>>

const COMMAND_ONLY_COMBOS: readonly AppCommandShortcutCombo[] = ['command-or-ctrl']
const COMMAND_SHIFT_COMBOS: readonly AppCommandShortcutCombo[] = ['command-shift', 'command-or-ctrl-shift']
const COMMAND_OR_CTRL_SHIFT_COMBOS: readonly AppCommandShortcutCombo[] = ['command-or-ctrl-shift']
const NO_SHORTCUT_COMBOS: readonly AppCommandShortcutCombo[] = []

function normalizeShortcutKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key
}

for (const [id, definition] of Object.entries(APP_COMMAND_DEFINITIONS) as Array<[AppCommandId, AppCommandDefinition]>) {
  const shortcut = definition.shortcut
  if (!shortcut) continue
  shortcutKeyMaps[shortcut.combo].set(normalizeShortcutKey(shortcut.key), id)
  for (const alias of shortcut.aliases ?? []) {
    shortcutKeyMaps[shortcut.combo].set(normalizeShortcutKey(alias), id)
  }
  if (shortcut.code) {
    shortcutCodeMaps[shortcut.combo].set(shortcut.code, id)
  }
}

export function isAppCommandId(value: string): value is AppCommandId {
  return APP_COMMAND_SET.has(value)
}

export function isNativeMenuCommandId(value: string): value is AppCommandId {
  return NATIVE_MENU_COMMAND_SET.has(value)
}

export function getDeterministicShortcutQaDefinition(
  id: AppCommandId,
): AppCommandDeterministicQaDefinition | null {
  const definition = APP_COMMAND_DEFINITIONS[id]
  if (!definition.shortcut) return null

  return {
    preferredMode:
      definition.preferredShortcutQaMode
      ?? (definition.menuOwned ? 'native-menu-command' : 'renderer-shortcut-event'),
    supportsRendererShortcutEvent: true,
    supportsNativeMenuCommand: definition.menuOwned,
    requiresManualNativeAcceleratorQa: MANUAL_NATIVE_ACCELERATOR_QA_COMMAND_SET.has(id),
  }
}

export function getShortcutEventInit(
  id: AppCommandId,
  options: AppCommandShortcutEventOptions = {},
): AppCommandShortcutEventInit | null {
  const shortcut = APP_COMMAND_DEFINITIONS[id].shortcut
  if (!shortcut) return null

  const useControl = options.preferControl ?? false

  return {
    key: shortcut.key,
    code: shortcut.code,
    altKey: false,
    bubbles: true,
    cancelable: true,
    ctrlKey: useControl,
    metaKey: !useControl,
    shiftKey: shortcut.combo !== 'command-or-ctrl',
  }
}

export function shortcutCombosForEvent({
  altKey,
  ctrlKey,
  metaKey,
  shiftKey,
}: Pick<ShortcutEventLike, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): readonly AppCommandShortcutCombo[] {
  if (altKey || (!metaKey && !ctrlKey)) return NO_SHORTCUT_COMBOS
  if (isMac() && ctrlKey) return NO_SHORTCUT_COMBOS
  if (shiftKey) {
    return metaKey && !ctrlKey ? COMMAND_SHIFT_COMBOS : COMMAND_OR_CTRL_SHIFT_COMBOS
  }
  return COMMAND_ONLY_COMBOS
}

export function findShortcutCommandId(
  combo: AppCommandShortcutCombo,
  key: string,
  code?: string,
): AppCommandId | null {
  if (code) {
    const codeMatch = shortcutCodeMaps[combo].get(code)
    if (codeMatch) return codeMatch
  }
  return shortcutKeyMaps[combo].get(normalizeShortcutKey(key)) ?? null
}

export function findShortcutCommandIdForEvent(event: ShortcutEventLike): AppCommandId | null {
  for (const combo of shortcutCombosForEvent(event)) {
    const commandId = findShortcutCommandId(combo, event.key, event.code)
    if (commandId) return commandId
  }
  return null
}

export function formatShortcutDisplay(
  shortcut: Pick<AppCommandShortcutDefinition, 'display'>,
): string {
  if (isMac()) return shortcut.display

  return shortcut.display
    .replaceAll('⌘⇧', 'Ctrl+Shift+')
    .replaceAll('⌘', 'Ctrl+')
    .replaceAll('⌫', 'Backspace')
    .replaceAll('⌦', 'Delete')
    .replaceAll('←', 'Left')
    .replaceAll('→', 'Right')
    .replaceAll('↵', 'Enter')
}

export function getAppCommandShortcutDisplay(id: AppCommandId): string | undefined {
  const shortcut = APP_COMMAND_DEFINITIONS[id].shortcut
  return shortcut ? formatShortcutDisplay(shortcut) : undefined
}
