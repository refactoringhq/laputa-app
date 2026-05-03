import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../appCommandCatalog'
import type { CommandAction } from './types'

interface EditorFindCommandsConfig {
  activeFileKind?: 'markdown' | 'text' | 'binary'
  hasActiveNote: boolean
  onFindInNote?: () => void
  onReplaceInNote?: () => void
}

interface EditorFindCommandConfig {
  execute?: () => void
  id: string
  keywords: string[]
  label: string
  shortcut?: string
  searchEnabled: boolean
}

const noop = () => {}

function canSearchCurrentNote(config: EditorFindCommandsConfig): boolean {
  const activeFileKind = config.activeFileKind ?? 'markdown'
  return config.hasActiveNote && activeFileKind !== 'binary'
}

function createEditorFindCommand(config: EditorFindCommandConfig): CommandAction {
  return {
    id: config.id,
    label: config.label,
    group: 'Note',
    shortcut: config.shortcut,
    keywords: config.keywords,
    enabled: config.searchEnabled && !!config.execute,
    execute: config.execute ?? noop,
  }
}

export function buildEditorFindCommands(config: EditorFindCommandsConfig): CommandAction[] {
  const searchEnabled = canSearchCurrentNote(config)

  return [
    createEditorFindCommand({
      id: 'find-in-note',
      label: 'Find in Note',
      shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.editFindInNote),
      keywords: ['find', 'search', 'current', 'editor'],
      searchEnabled,
      execute: config.onFindInNote,
    }),
    createEditorFindCommand({
      id: 'replace-in-note',
      label: 'Replace in Note',
      keywords: ['find', 'replace', 'regex', 'current', 'editor'],
      searchEnabled,
      execute: config.onReplaceInNote,
    }),
  ]
}
