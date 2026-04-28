import { createTranslator, type AppLocale, type TranslationKey } from '../../lib/i18n'
import type { CommandAction, CommandGroup } from './types'

type Translate = ReturnType<typeof createTranslator>
type CommandLabeler = (command: CommandAction, t: Translate) => string

const GROUP_LABEL_KEYS = {
  Navigation: 'command.group.navigation',
  Note: 'command.group.note',
  Git: 'command.group.git',
  View: 'command.group.view',
  Settings: 'command.group.settings',
} satisfies Record<CommandGroup, TranslationKey>

const STATIC_LABEL_KEYS: Partial<Record<string, TranslationKey>> = {
  'search-notes': 'command.navigation.searchNotes',
  'go-all': 'command.navigation.goAllNotes',
  'go-archived': 'command.navigation.goArchived',
  'go-changes': 'command.navigation.goChanges',
  'go-pulse': 'command.navigation.goHistory',
  'go-back': 'command.navigation.goBack',
  'go-forward': 'command.navigation.goForward',
  'go-inbox': 'command.navigation.goInbox',
  'rename-folder': 'command.navigation.renameFolder',
  'delete-folder': 'command.navigation.deleteFolder',
  'filter-open': 'command.navigation.showOpenNotes',
  'filter-archived': 'command.navigation.showArchivedNotes',
  'create-note': 'command.note.newNote',
  'create-type': 'command.note.newType',
  'save-note': 'command.note.saveNote',
  'find-in-note': 'command.note.findInNote',
  'replace-in-note': 'command.note.replaceInNote',
  'delete-note': 'command.note.deleteNote',
  'restore-deleted-note': 'command.note.restoreDeleted',
  'set-note-icon': 'command.note.setIcon',
  'change-note-type': 'command.note.changeType',
  'move-note-to-folder': 'command.note.moveToFolder',
  'remove-note-icon': 'command.note.removeIcon',
  'open-in-new-window': 'command.note.openNewWindow',
  'initialize-git': 'command.git.initialize',
  'commit-push': 'command.git.commitPush',
  'add-remote': 'command.git.addRemote',
  'git-pull': 'command.git.pull',
  'resolve-conflicts': 'command.git.resolveConflicts',
  'view-changes': 'command.git.viewChanges',
  'view-editor': 'command.view.editorOnly',
  'view-editor-list': 'command.view.editorNoteList',
  'view-all': 'command.view.fullLayout',
  'toggle-inspector': 'command.view.toggleProperties',
  'toggle-diff': 'command.view.toggleDiff',
  'toggle-raw-editor': 'command.view.toggleRaw',
  'toggle-ai-panel': 'command.view.toggleAiPanel',
  'new-ai-chat': 'command.view.newAiChat',
  'toggle-backlinks': 'command.view.toggleBacklinks',
  'zoom-reset': 'command.view.resetZoom',
  'create-empty-vault': 'command.settings.createEmptyVault',
  'open-vault': 'command.settings.openVault',
  'remove-vault': 'command.settings.removeVault',
  'restore-getting-started': 'command.settings.restoreGettingStarted',
  'reload-vault': 'command.settings.reloadVault',
  'repair-vault': 'command.settings.repairVault',
  'toggle-gitignored-files-visibility': 'command.settings.toggleGitignoredFilesVisibility',
  'open-ai-agents': 'command.ai.openAgents',
  'restore-vault-ai-guidance': 'command.ai.restoreGuidance',
}

function stripKnownPrefix(label: string, prefix: string): string {
  return label.startsWith(prefix) ? label.slice(prefix.length) : label
}

function parenthesizedSuffix(label: string): string | null {
  return label.match(/\(([^)]+)\)$/)?.[1] ?? null
}

function localizeNoteStateCommand(command: CommandAction, t: Translate): string | null {
  if (command.id === 'archive-note') {
    return t(command.label === 'Unarchive Note' ? 'command.note.unarchiveNote' : 'command.note.archiveNote')
  }

  if (command.id === 'toggle-favorite') {
    return t(command.label === 'Remove from Favorites' ? 'command.note.removeFavorite' : 'command.note.addFavorite')
  }

  if (command.id === 'toggle-organized') {
    return t(command.label === 'Mark as Unorganized' ? 'command.note.markUnorganized' : 'command.note.markOrganized')
  }

  return null
}

function localizeColumnsCommand(command: CommandAction, t: Translate): string {
  if (command.label === 'Customize All Notes columns') return t('noteList.properties.customizeAllColumns')
  if (command.label === 'Customize Inbox columns') return t('noteList.properties.customizeInboxColumns')
  return t('noteList.properties.customizeColumns')
}

const VIEW_STATE_LABELERS: Partial<Record<string, CommandLabeler>> = {
  'toggle-note-layout': (command, t) => t(command.label === 'Use Left-Aligned Note Layout' ? 'command.view.leftLayout' : 'command.view.centerLayout'),
  'zoom-in': (command, t) => t('command.view.zoomIn', { zoom: parenthesizedSuffix(command.label)?.replace('%', '') ?? '' }),
  'zoom-out': (command, t) => t('command.view.zoomOut', { zoom: parenthesizedSuffix(command.label)?.replace('%', '') ?? '' }),
  'customize-note-list-columns': localizeColumnsCommand,
}

function localizeViewStateCommand(command: CommandAction, t: Translate): string | null {
  return VIEW_STATE_LABELERS[command.id]?.(command, t) ?? null
}

function localizeSettingsStateCommand(command: CommandAction, t: Translate): string | null {
  if (command.id === 'install-mcp') {
    return t(command.label === 'Manage External AI Tools…'
      ? 'command.settings.manageExternalAi'
      : 'command.settings.setupExternalAi')
  }

  if (command.id === 'switch-default-ai-agent') {
    const agent = parenthesizedSuffix(command.label)
    return agent
      ? t('command.ai.switchDefaultWithAgent', { agent })
      : t('command.ai.switchDefault')
  }

  if (command.id.startsWith('switch-ai-agent-')) {
    return t('command.ai.switchToAgent', {
      agent: stripKnownPrefix(command.label, 'Switch AI Agent to '),
    })
  }

  return null
}

function localizeTypeCommand(command: CommandAction, t: Translate): string | null {
  if (command.id.startsWith('new-') && command.group === 'Note') {
    return t('command.note.newTypedNote', { type: stripKnownPrefix(command.label, 'New ') })
  }

  if (command.id.startsWith('list-') && command.group === 'Navigation') {
    return t('command.navigation.listType', { type: stripKnownPrefix(command.label, 'List ') })
  }

  return null
}

export function localizeCommandGroup(group: CommandGroup, locale: AppLocale = 'en'): string {
  return createTranslator(locale)(GROUP_LABEL_KEYS[group])
}

export function localizeCommandActions(commands: CommandAction[], locale: AppLocale = 'en'): CommandAction[] {
  const t = createTranslator(locale)
  return commands.map((command) => {
    const key = STATIC_LABEL_KEYS[command.id]
    const label = key
      ? t(key)
      : localizeNoteStateCommand(command, t)
        ?? localizeViewStateCommand(command, t)
        ?? localizeSettingsStateCommand(command, t)
        ?? localizeTypeCommand(command, t)
        ?? command.label
    return label === command.label ? command : { ...command, label }
  })
}
