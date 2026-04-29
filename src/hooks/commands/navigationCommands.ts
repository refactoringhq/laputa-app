import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../appCommandCatalog'
import type { CommandAction } from './types'
import type { SidebarSelection } from '../../types'

interface NavigationCommandsConfig {
  onQuickOpen: () => void
  onSelect: (sel: SidebarSelection) => void
  selection?: SidebarSelection
  onRenameFolder?: () => void
  onDeleteFolder?: () => void
  onRevealSelectedFolder?: () => void
  onCopySelectedFolderPath?: () => void
  showInbox?: boolean
  onGoBack?: () => void
  onGoForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
}

interface FolderCommandsConfig {
  canMutateFolder: boolean
  folderSelected: boolean
  onCopySelectedFolderPath?: () => void
  onDeleteFolder?: () => void
  onRenameFolder?: () => void
  onRevealSelectedFolder?: () => void
}

function canRunFolderCommand(folderSelected: boolean, action?: () => void): boolean {
  return folderSelected && action !== undefined
}

function runOptionalCommand(action?: () => void) {
  action?.()
}

function buildFolderCommands({
  canMutateFolder,
  folderSelected,
  onCopySelectedFolderPath,
  onDeleteFolder,
  onRenameFolder,
  onRevealSelectedFolder,
}: FolderCommandsConfig): CommandAction[] {
  return [
    {
      id: 'reveal-selected-folder',
      label: 'Reveal Folder in Finder',
      group: 'Navigation',
      keywords: ['folder', 'directory', 'finder', 'reveal', 'show', 'filesystem'],
      enabled: canRunFolderCommand(folderSelected, onRevealSelectedFolder),
      execute: () => runOptionalCommand(onRevealSelectedFolder),
    },
    {
      id: 'copy-selected-folder-path',
      label: 'Copy Folder Path',
      group: 'Navigation',
      keywords: ['folder', 'directory', 'path', 'copy', 'clipboard'],
      enabled: canRunFolderCommand(folderSelected, onCopySelectedFolderPath),
      execute: () => runOptionalCommand(onCopySelectedFolderPath),
    },
    {
      id: 'rename-folder',
      label: 'Rename Folder',
      group: 'Navigation',
      keywords: ['folder', 'directory', 'sidebar', 'rename'],
      enabled: canRunFolderCommand(canMutateFolder, onRenameFolder),
      execute: () => runOptionalCommand(onRenameFolder),
    },
    {
      id: 'delete-folder',
      label: 'Delete Folder',
      group: 'Navigation',
      keywords: ['folder', 'directory', 'sidebar', 'delete', 'remove'],
      enabled: canRunFolderCommand(canMutateFolder, onDeleteFolder),
      execute: () => runOptionalCommand(onDeleteFolder),
    },
  ]
}

function buildBaseCommands(config: NavigationCommandsConfig): CommandAction[] {
  const {
    onQuickOpen,
    onSelect,
    onGoBack,
    onGoForward,
    canGoBack,
    canGoForward,
  } = config

  return [
    { id: 'search-notes', label: 'Search Notes', group: 'Navigation', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.fileQuickOpen), keywords: ['find', 'open', 'quick'], enabled: true, execute: onQuickOpen },
    { id: 'go-all', label: 'Go to All Notes', group: 'Navigation', keywords: ['filter'], enabled: true, execute: () => onSelect({ kind: 'filter', filter: 'all' }) },
    { id: 'go-archived', label: 'Go to Archived', group: 'Navigation', keywords: [], enabled: true, execute: () => onSelect({ kind: 'filter', filter: 'archived' }) },
    { id: 'go-changes', label: 'Go to Changes', group: 'Navigation', keywords: ['git', 'modified', 'pending'], enabled: true, execute: () => onSelect({ kind: 'filter', filter: 'changes' }) },
    { id: 'go-pulse', label: 'Go to History', group: 'Navigation', keywords: ['activity', 'history', 'commits', 'git', 'feed'], enabled: true, execute: () => onSelect({ kind: 'filter', filter: 'pulse' }) },
    { id: 'go-back', label: 'Go Back', group: 'Navigation', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewGoBack), keywords: ['previous', 'history', 'back'], enabled: !!canGoBack, execute: () => onGoBack?.() },
    { id: 'go-forward', label: 'Go Forward', group: 'Navigation', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewGoForward), keywords: ['next', 'history', 'forward'], enabled: !!canGoForward, execute: () => onGoForward?.() },
  ]
}

function insertInboxCommand(commands: CommandAction[], showInbox: boolean, onSelect: (sel: SidebarSelection) => void) {
  if (!showInbox) return commands

  commands.splice(5, 0, {
    id: 'go-inbox',
    label: 'Go to Inbox',
    group: 'Navigation',
    keywords: ['inbox', 'unlinked', 'orphan', 'unorganized', 'triage'],
    enabled: true,
    execute: () => onSelect({ kind: 'filter', filter: 'inbox' }),
  })
  return commands
}

export function buildNavigationCommands(config: NavigationCommandsConfig): CommandAction[] {
  const {
    onSelect,
    selection,
    onRenameFolder,
    onDeleteFolder,
    onRevealSelectedFolder,
    onCopySelectedFolderPath,
    showInbox = true,
  } = config
  const folderSelected = selection?.kind === 'folder'
  const canMutateFolder = folderSelected && selection.path.length > 0
  const commands = [
    ...buildBaseCommands(config),
    ...buildFolderCommands({
      canMutateFolder,
      folderSelected,
      onRenameFolder,
      onDeleteFolder,
      onRevealSelectedFolder,
      onCopySelectedFolderPath,
    }),
  ]
  return insertInboxCommand(commands, showInbox, onSelect)
}
