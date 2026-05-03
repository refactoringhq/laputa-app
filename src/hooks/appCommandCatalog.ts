import appCommandManifest from '../shared/appCommandManifest.json' with { type: 'json' }
import type { SidebarFilter } from '../types'
import { isMac } from '../utils/platform'
import type { ViewMode } from './useViewMode'

type AppCommandKey = keyof typeof appCommandManifest.commands
type ShortcutEventLike = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key' | 'code'>

export type AppCommandShortcutCombo =
  | 'command-or-ctrl'
  | 'command-or-ctrl-shift'
  | 'command-shift'
export type AppCommandDeterministicQaMode =
  | 'renderer-shortcut-event'
  | 'native-menu-command'

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
  | 'onPastePlainText'
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

interface AppCommandManifestShortcutDefinition extends AppCommandShortcutDefinition {
  accelerator: string
  requiresManualNativeAcceleratorQa?: boolean
}

interface AppCommandManifestDefinition {
  id: string
  route: AppCommandRoute
  menuOwned: boolean
  shortcut?: AppCommandManifestShortcutDefinition
  preferredShortcutQaMode?: AppCommandDeterministicQaMode
}

export interface AppCommandDefinition {
  route: AppCommandRoute
  menuOwned: boolean
  shortcut?: AppCommandShortcutDefinition
  preferredShortcutQaMode?: AppCommandDeterministicQaMode
}

type PlatformLabel = string | {
  macos?: string
  windows?: string
  linux?: string
  default: string
}

type AppCommandMenuManifestItem =
  | { kind: 'separator' }
  | {
      kind: 'command'
      command: AppCommandKey
      id?: string
      label: PlatformLabel
      accelerator?: string | null
      enabled?: boolean
    }
  | {
      kind: 'menu-event'
      id: string
      label: PlatformLabel
      accelerator?: string | null
      enabled?: boolean
    }

interface AppCommandMenuManifestSection {
  label: string
  items: AppCommandMenuManifestItem[]
}

export type AppCommandMenuItem =
  | { kind: 'separator' }
  | {
      kind: 'command'
      commandId: string
      menuItemId: string
      label: string
      shortcut?: string
      enabled?: boolean
    }

type AppCommandMenuStateGroupReference =
  | { command: AppCommandKey }
  | { id: string }

type AppCommandMenuStateGroupName = keyof typeof appCommandManifest.menuStateGroups

const APP_COMMAND_MANIFEST_COMMANDS = appCommandManifest.commands as Record<AppCommandKey, AppCommandManifestDefinition>
const APP_COMMAND_MANIFEST_MENUS = appCommandManifest.menus as AppCommandMenuManifestSection[]
const APP_COMMAND_MANIFEST_APP_MENU = appCommandManifest.appMenu as AppCommandMenuManifestItem[]
const APP_COMMAND_MANIFEST_STATE_GROUPS = appCommandManifest.menuStateGroups as Record<
  AppCommandMenuStateGroupName,
  AppCommandMenuStateGroupReference[]
>

export const APP_COMMAND_IDS = Object.fromEntries(
  Object.entries(APP_COMMAND_MANIFEST_COMMANDS).map(([key, command]) => [key, command.id]),
) as { readonly [K in AppCommandKey]: string }

export type AppCommandId = (typeof APP_COMMAND_IDS)[AppCommandKey]

const APP_COMMAND_SET = new Set<string>(Object.values(APP_COMMAND_IDS))

function toShortcutDefinition(
  shortcut: AppCommandManifestShortcutDefinition | undefined,
): AppCommandShortcutDefinition | undefined {
  if (!shortcut) return undefined

  return {
    combo: shortcut.combo,
    key: shortcut.key,
    aliases: shortcut.aliases,
    code: shortcut.code,
    display: shortcut.display,
  }
}

export const APP_COMMAND_DEFINITIONS = Object.fromEntries(
  Object.values(APP_COMMAND_MANIFEST_COMMANDS).map((command) => [
    command.id,
    {
      route: command.route,
      menuOwned: command.menuOwned,
      shortcut: toShortcutDefinition(command.shortcut),
      preferredShortcutQaMode: command.preferredShortcutQaMode,
    },
  ]),
) as Record<AppCommandId, AppCommandDefinition>

function resolvePlatformLabel(label: PlatformLabel): string {
  if (typeof label === 'string') return label
  if (isMac() && label.macos) return label.macos
  return label.default
}

function formatAcceleratorDisplay(accelerator: string): string {
  const commandPrefix = isMac() ? '⌘' : 'Ctrl+'
  const commandShiftPrefix = isMac() ? '⌘⇧' : 'Ctrl+Shift+'

  return accelerator
    .replaceAll('CmdOrCtrl+Shift+', commandShiftPrefix)
    .replaceAll('CmdOrCtrl+', commandPrefix)
    .replaceAll('Backspace', isMac() ? '⌫' : 'Backspace')
    .replaceAll('Delete', isMac() ? '⌦' : 'Delete')
    .replaceAll('Left', isMac() ? '←' : 'Left')
    .replaceAll('Right', isMac() ? '→' : 'Right')
    .replaceAll('Enter', isMac() ? '↵' : 'Enter')
}

function menuShortcutForCommand(
  item: Extract<AppCommandMenuManifestItem, { kind: 'command' }>,
  command: AppCommandManifestDefinition,
): string | undefined {
  if (typeof item.accelerator === 'string') return formatAcceleratorDisplay(item.accelerator)
  if (command.shortcut) return formatShortcutDisplay(command.shortcut)
  return undefined
}

function toMenuItem(item: AppCommandMenuManifestItem): AppCommandMenuItem {
  if (item.kind === 'separator') return { kind: 'separator' }

  if (item.kind === 'menu-event') {
    return {
      kind: 'command',
      commandId: item.id,
      menuItemId: item.id,
      label: resolvePlatformLabel(item.label),
      shortcut: typeof item.accelerator === 'string'
        ? formatAcceleratorDisplay(item.accelerator)
        : undefined,
      enabled: item.enabled,
    }
  }

  const command = APP_COMMAND_MANIFEST_COMMANDS[item.command]
  return {
    kind: 'command',
    commandId: command.id,
    menuItemId: item.id ?? command.id,
    label: resolvePlatformLabel(item.label),
    shortcut: menuShortcutForCommand(item, command),
    enabled: item.enabled,
  }
}

function menuCommandIds(items: AppCommandMenuItem[]): string[] {
  return items.flatMap(item => item.kind === 'command' ? [item.commandId] : [])
}

export const APP_COMMAND_MENU_SECTIONS = APP_COMMAND_MANIFEST_MENUS.map(section => ({
  label: section.label,
  items: section.items.map(toMenuItem),
}))

const APP_COMMAND_APP_MENU_ITEMS = APP_COMMAND_MANIFEST_APP_MENU.map(toMenuItem)

export const APP_COMMAND_MENU_STATE_GROUPS = Object.fromEntries(
  Object.entries(APP_COMMAND_MANIFEST_STATE_GROUPS).map(([name, references]) => [
    name,
    references.map(reference => 'command' in reference
      ? APP_COMMAND_MANIFEST_COMMANDS[reference.command].id
      : reference.id),
  ]),
) as Record<AppCommandMenuStateGroupName, string[]>

const NATIVE_MENU_COMMAND_SET = new Set<string>(
  [
    ...APP_COMMAND_MENU_SECTIONS.flatMap(section => menuCommandIds(section.items)),
    ...menuCommandIds(APP_COMMAND_APP_MENU_ITEMS),
  ].filter(id => APP_COMMAND_SET.has(id)),
)

const MANUAL_NATIVE_ACCELERATOR_QA_COMMAND_SET = new Set<AppCommandId>(
  Object.values(APP_COMMAND_MANIFEST_COMMANDS)
    .filter(command => command.shortcut?.requiresManualNativeAcceleratorQa)
    .map(command => command.id),
)

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
