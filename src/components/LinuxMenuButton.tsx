import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AppCommandId } from '../hooks/appCommandCatalog'
import { APP_COMMAND_DEFINITIONS, APP_COMMAND_IDS } from '../hooks/appCommandCatalog'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

type MenuItem =
  | { kind: 'separator' }
  | { kind: 'command'; commandId: MenuCommandId; label: string }
  | { kind: 'action'; action: () => void; label: string; shortcut?: string }

type MenuSection = {
  items: ReadonlyArray<MenuItem>
  label: string
}

type MenuCommandId = AppCommandId | 'edit-toggle-note-list-search'

const MENU_SECTIONS: ReadonlyArray<MenuSection> = [
  {
    label: 'File',
    items: [
      { kind: 'command', label: 'New Note', commandId: APP_COMMAND_IDS.fileNewNote },
      { kind: 'command', label: 'New Type', commandId: APP_COMMAND_IDS.fileNewType },
      { kind: 'command', label: 'Quick Open', commandId: APP_COMMAND_IDS.fileQuickOpen },
      { kind: 'separator' },
      { kind: 'command', label: 'Save', commandId: APP_COMMAND_IDS.fileSave },
    ],
  },
  {
    label: 'Edit',
    items: [
      { kind: 'command', label: 'Find in Note', commandId: APP_COMMAND_IDS.editFindInNote },
      { kind: 'command', label: 'Replace in Note', commandId: APP_COMMAND_IDS.editReplaceInNote },
      { kind: 'command', label: 'Find in Vault', commandId: APP_COMMAND_IDS.editFindInVault },
      { kind: 'command', label: 'Toggle Note List Search', commandId: 'edit-toggle-note-list-search' },
      { kind: 'command', label: 'Toggle Diff Mode', commandId: APP_COMMAND_IDS.editToggleDiff },
    ],
  },
  {
    label: 'View',
    items: [
      { kind: 'command', label: 'Editor Only', commandId: APP_COMMAND_IDS.viewEditorOnly },
      { kind: 'command', label: 'Editor + Notes', commandId: APP_COMMAND_IDS.viewEditorList },
      { kind: 'command', label: 'All Panels', commandId: APP_COMMAND_IDS.viewAll },
      { kind: 'separator' },
      { kind: 'command', label: 'Toggle Properties Panel', commandId: APP_COMMAND_IDS.viewToggleProperties },
      { kind: 'separator' },
      { kind: 'command', label: 'Zoom In', commandId: APP_COMMAND_IDS.viewZoomIn },
      { kind: 'command', label: 'Zoom Out', commandId: APP_COMMAND_IDS.viewZoomOut },
      { kind: 'command', label: 'Actual Size', commandId: APP_COMMAND_IDS.viewZoomReset },
      { kind: 'separator' },
      { kind: 'command', label: 'Command Palette', commandId: APP_COMMAND_IDS.viewCommandPalette },
    ],
  },
  {
    label: 'Go',
    items: [
      { kind: 'command', label: 'All Notes', commandId: APP_COMMAND_IDS.goAllNotes },
      { kind: 'command', label: 'Archived', commandId: APP_COMMAND_IDS.goArchived },
      { kind: 'command', label: 'Changes', commandId: APP_COMMAND_IDS.goChanges },
      { kind: 'command', label: 'Inbox', commandId: APP_COMMAND_IDS.goInbox },
      { kind: 'separator' },
      { kind: 'command', label: 'Go Back', commandId: APP_COMMAND_IDS.viewGoBack },
      { kind: 'command', label: 'Go Forward', commandId: APP_COMMAND_IDS.viewGoForward },
    ],
  },
  {
    label: 'Note',
    items: [
      { kind: 'command', label: 'Toggle Organized', commandId: APP_COMMAND_IDS.noteToggleOrganized },
      { kind: 'command', label: 'Archive Note', commandId: APP_COMMAND_IDS.noteArchive },
      { kind: 'command', label: 'Delete Note', commandId: APP_COMMAND_IDS.noteDelete },
      { kind: 'command', label: 'Restore Deleted Note', commandId: APP_COMMAND_IDS.noteRestoreDeleted },
      { kind: 'separator' },
      { kind: 'command', label: 'Open in New Window', commandId: APP_COMMAND_IDS.noteOpenInNewWindow },
      { kind: 'separator' },
      { kind: 'command', label: 'Toggle Raw Editor', commandId: APP_COMMAND_IDS.editToggleRawEditor },
      { kind: 'command', label: 'Toggle AI Panel', commandId: APP_COMMAND_IDS.viewToggleAiChat },
      { kind: 'command', label: 'Toggle Backlinks', commandId: APP_COMMAND_IDS.viewToggleBacklinks },
    ],
  },
  {
    label: 'Vault',
    items: [
      { kind: 'command', label: 'Open Vault…', commandId: APP_COMMAND_IDS.vaultOpen },
      { kind: 'command', label: 'Remove Vault from List', commandId: APP_COMMAND_IDS.vaultRemove },
      { kind: 'command', label: 'Restore Getting Started', commandId: APP_COMMAND_IDS.vaultRestoreGettingStarted },
      { kind: 'separator' },
      { kind: 'command', label: 'Add Remote…', commandId: APP_COMMAND_IDS.vaultAddRemote },
      { kind: 'command', label: 'Commit & Push', commandId: APP_COMMAND_IDS.vaultCommitPush },
      { kind: 'command', label: 'Pull from Remote', commandId: APP_COMMAND_IDS.vaultPull },
      { kind: 'command', label: 'Resolve Conflicts', commandId: APP_COMMAND_IDS.vaultResolveConflicts },
      { kind: 'command', label: 'View Pending Changes', commandId: APP_COMMAND_IDS.vaultViewChanges },
      { kind: 'separator' },
      { kind: 'command', label: 'Reload Vault', commandId: APP_COMMAND_IDS.vaultReload },
      { kind: 'command', label: 'Repair Vault', commandId: APP_COMMAND_IDS.vaultRepair },
      { kind: 'command', label: 'Set Up External AI Tools…', commandId: APP_COMMAND_IDS.vaultInstallMcp },
    ],
  },
  {
    label: 'Window',
    items: [
      { kind: 'action', label: 'Minimize', action: () => void getCurrentWindow().minimize().catch(() => {}) },
      { kind: 'action', label: 'Maximize', action: () => void getCurrentWindow().toggleMaximize().catch(() => {}) },
      { kind: 'separator' },
      { kind: 'action', label: 'Close', action: () => void getCurrentWindow().close().catch(() => {}) },
    ],
  },
]

function formatShortcutKey(key: string): string {
  switch (key) {
    case 'ArrowLeft':
      return '←'
    case 'ArrowRight':
      return '→'
    default:
      return key.length === 1 ? key.toUpperCase() : key
  }
}

function getLinuxShortcut(commandId: MenuCommandId): string | null {
  if (commandId === 'edit-toggle-note-list-search') {
    return 'Ctrl+F'
  }

  const shortcut = APP_COMMAND_DEFINITIONS[commandId].shortcut
  if (!shortcut) return null

  const modifier = shortcut.combo === 'command-or-ctrl' ? 'Ctrl' : 'Ctrl+Shift'
  return `${modifier}+${formatShortcutKey(shortcut.key)}`
}

function triggerMenuCommand(commandId: MenuCommandId): void {
  void invoke('trigger_menu_command', { id: commandId }).catch(() => {})
}

function HamburgerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="2" y1="4" x2="12" y2="4" />
      <line x1="2" y1="7" x2="12" y2="7" />
      <line x1="2" y1="10" x2="12" y2="10" />
    </svg>
  )
}

export function LinuxMenuButton() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Application menu"
          className="h-full w-[38px] rounded-none text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
          data-no-drag
        >
          <HamburgerIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0} className="min-w-[200px]">
        {MENU_SECTIONS.map((section) => (
          <DropdownMenuSub key={section.label}>
            <DropdownMenuSubTrigger>{section.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[220px]">
              {section.items.map((item, index) => {
                if (item.kind === 'separator') {
                  return <DropdownMenuSeparator key={`${section.label}-${index}`} />
                }

                if (item.kind === 'command') {
                  const shortcut = getLinuxShortcut(item.commandId)
                  return (
                    <DropdownMenuItem
                      key={item.commandId}
                      onSelect={() => triggerMenuCommand(item.commandId)}
                    >
                      <span>{item.label}</span>
                      {shortcut && (
                        <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
                      )}
                    </DropdownMenuItem>
                  )
                }

                return (
                  <DropdownMenuItem key={`${section.label}-${item.label}`} onSelect={item.action}>
                    <span>{item.label}</span>
                    {item.shortcut && <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
