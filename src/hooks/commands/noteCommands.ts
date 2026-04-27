import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../appCommandCatalog'
import { buildEditorFindCommands } from './editorFindCommands'
import type { CommandAction } from './types'

interface NoteCommandsConfig {
  hasActiveNote: boolean
  activeTabPath: string | null
  activeFileKind?: 'markdown' | 'text' | 'binary'
  isArchived: boolean
  activeNoteHasIcon?: boolean
  onCreateNote: () => void
  onCreateType?: () => void
  onSave: () => void
  onFindInNote?: () => void
  onReplaceInNote?: () => void
  onDeleteNote: (path: string) => void
  onArchiveNote: (path: string) => void
  onUnarchiveNote: (path: string) => void
  onChangeNoteType?: () => void
  onMoveNoteToFolder?: () => void
  canMoveNoteToFolder?: boolean
  onSetNoteIcon?: () => void
  onRemoveNoteIcon?: () => void
  onOpenInNewWindow?: () => void
  onRevealActiveFile?: (path: string) => void
  onCopyActiveFilePath?: (path: string) => void
  onOpenActiveFileExternal?: (path: string) => void
  onToggleFavorite?: (path: string) => void
  isFavorite?: boolean
  onToggleOrganized?: (path: string) => void
  isOrganized?: boolean
  onRestoreDeletedNote?: () => void
  canRestoreDeletedNote?: boolean
}

interface NoteCommandConfig {
  id: string
  label: string
  keywords: string[]
  enabled: boolean
  execute?: () => void
  shortcut?: string
  path?: string | null
  run?: (path: string) => void
}

function createNoteCommand(config: NoteCommandConfig): CommandAction {
  return {
    id: config.id,
    label: config.label,
    group: 'Note',
    shortcut: config.shortcut,
    keywords: config.keywords,
    enabled: config.enabled,
    execute: () => {
      if (config.path && config.run) {
        config.run(config.path)
        return
      }
      config.execute?.()
    },
  }
}

function buildCoreNoteCommands(config: NoteCommandsConfig): CommandAction[] {
  return [
    createNoteCommand({
      id: 'create-note',
      label: 'New Note',
      shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.fileNewNote),
      keywords: ['new', 'create', 'add'],
      enabled: true,
      execute: config.onCreateNote,
    }),
    createNoteCommand({
      id: 'create-type',
      label: 'New Type',
      keywords: ['new', 'create', 'type', 'template'],
      enabled: !!config.onCreateType,
      execute: () => config.onCreateType?.(),
    }),
    createNoteCommand({
      id: 'save-note',
      label: 'Save Note',
      shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.fileSave),
      keywords: ['write'],
      enabled: config.hasActiveNote,
      execute: config.onSave,
    }),
    ...buildEditorFindCommands(config),
  ]
}

function buildPathNoteCommands(config: NoteCommandsConfig): CommandAction[] {
  return [
    ...buildDestructiveNoteCommands(config),
    ...buildPinnedNoteCommands(config),
  ]
}

function buildDestructiveNoteCommands(config: NoteCommandsConfig): CommandAction[] {
  return [
    createNoteCommand({
      id: 'delete-note',
      label: 'Delete Note',
      shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteDelete),
      keywords: ['delete', 'remove'],
      enabled: config.hasActiveNote,
      path: config.activeTabPath,
      run: config.onDeleteNote,
    }),
    createNoteCommand({
      id: 'archive-note',
      label: config.isArchived ? 'Unarchive Note' : 'Archive Note',
      keywords: ['archive'],
      enabled: config.hasActiveNote,
      path: config.activeTabPath,
      run: config.isArchived ? config.onUnarchiveNote : config.onArchiveNote,
    }),
  ]
}

function buildPinnedNoteCommands(config: NoteCommandsConfig): CommandAction[] {
  return [
    createNoteCommand({
      id: 'toggle-favorite',
      label: config.isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
      shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteToggleFavorite),
      keywords: ['favorite', 'star', 'bookmark', 'pin'],
      enabled: config.hasActiveNote && !!config.onToggleFavorite,
      path: config.activeTabPath,
      run: (path) => config.onToggleFavorite?.(path),
    }),
    createNoteCommand({
      id: 'toggle-organized',
      label: config.isOrganized ? 'Mark as Unorganized' : 'Mark as Organized',
      shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteToggleOrganized),
      keywords: ['organized', 'inbox', 'triage', 'done'],
      enabled: config.hasActiveNote && !!config.onToggleOrganized,
      path: config.activeTabPath,
      run: (path) => config.onToggleOrganized?.(path),
    }),
  ]
}

function buildOptionalNoteCommands(config: NoteCommandsConfig): CommandAction[] {
  return [
    ...buildRecoveryCommands(config),
    ...buildFileActionCommands(config),
    ...buildRetargetingCommands(config),
    ...buildPresentationCommands(config),
  ]
}

function buildRecoveryCommands(config: NoteCommandsConfig): CommandAction[] {
  return [
    createNoteCommand({
      id: 'restore-deleted-note',
      label: 'Restore Deleted Note',
      keywords: ['restore', 'deleted', 'undelete', 'git', 'checkout'],
      enabled: !!config.canRestoreDeletedNote && !!config.onRestoreDeletedNote,
      execute: () => config.onRestoreDeletedNote?.(),
    }),
  ]
}

function buildRetargetingCommands(config: NoteCommandsConfig): CommandAction[] {
  return [
    createNoteCommand({
      id: 'set-note-icon',
      label: 'Set Note Icon',
      keywords: ['icon', 'emoji', 'set', 'add', 'change', 'picker'],
      enabled: config.hasActiveNote && !!config.onSetNoteIcon,
      execute: () => config.onSetNoteIcon?.(),
    }),
    createNoteCommand({
      id: 'change-note-type',
      label: 'Change Note Type…',
      keywords: ['type', 'change', 'retarget', 'section', 'move'],
      enabled: config.hasActiveNote && !!config.onChangeNoteType,
      execute: () => config.onChangeNoteType?.(),
    }),
    createNoteCommand({
      id: 'move-note-to-folder',
      label: 'Move Note to Folder…',
      keywords: ['folder', 'move', 'retarget', 'organize'],
      enabled: config.hasActiveNote && !!config.onMoveNoteToFolder && !!config.canMoveNoteToFolder,
      execute: () => config.onMoveNoteToFolder?.(),
    }),
  ]
}

function buildFileActionCommands(config: NoteCommandsConfig): CommandAction[] {
  const activeFileKind = config.activeFileKind ?? 'markdown'
  const hasNonMarkdownActiveFile = config.hasActiveNote && activeFileKind !== 'markdown'

  return [
    createNoteCommand({
      id: 'reveal-active-file',
      label: 'Reveal in Finder',
      keywords: ['file', 'folder', 'finder', 'reveal', 'show', 'filesystem'],
      enabled: config.hasActiveNote && !!config.onRevealActiveFile,
      path: config.activeTabPath,
      run: (path) => config.onRevealActiveFile?.(path),
    }),
    createNoteCommand({
      id: 'copy-active-file-path',
      label: 'Copy File Path',
      keywords: ['file', 'path', 'copy', 'clipboard', 'filesystem'],
      enabled: config.hasActiveNote && !!config.onCopyActiveFilePath,
      path: config.activeTabPath,
      run: (path) => config.onCopyActiveFilePath?.(path),
    }),
    createNoteCommand({
      id: 'open-active-file-external',
      label: 'Open in Default App',
      keywords: ['file', 'open', 'external', 'default', 'attachment'],
      enabled: hasNonMarkdownActiveFile && !!config.onOpenActiveFileExternal,
      path: config.activeTabPath,
      run: (path) => config.onOpenActiveFileExternal?.(path),
    }),
  ]
}

function buildPresentationCommands(config: NoteCommandsConfig): CommandAction[] {
  return [
    createNoteCommand({
      id: 'remove-note-icon',
      label: 'Remove Note Icon',
      keywords: ['icon', 'emoji', 'remove', 'delete', 'clear'],
      enabled: config.hasActiveNote && !!config.activeNoteHasIcon && !!config.onRemoveNoteIcon,
      execute: () => config.onRemoveNoteIcon?.(),
    }),
    createNoteCommand({
      id: 'open-in-new-window',
      label: 'Open in New Window',
      shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteOpenInNewWindow),
      keywords: ['window', 'new', 'detach', 'pop', 'external', 'separate'],
      enabled: config.hasActiveNote,
      execute: () => config.onOpenInNewWindow?.(),
    }),
  ]
}

export function buildNoteCommands(config: NoteCommandsConfig): CommandAction[] {
  return [
    ...buildCoreNoteCommands(config),
    ...buildPathNoteCommands(config),
    ...buildOptionalNoteCommands(config),
  ]
}
