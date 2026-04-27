import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../appCommandCatalog'
import type { CommandAction } from './types'
import type { ViewMode } from '../useViewMode'
import type { NoteLayout } from '../../types'
import { requestNewAiChat } from '../../utils/aiPromptBridge'

const NOTE_LAYOUT_COMMAND_LABELS: Record<NoteLayout, string> = {
  centered: 'Use Left-Aligned Note Layout',
  left: 'Use Centered Note Layout',
}

const noop = () => {}

interface ViewCommandsConfig {
  hasActiveNote: boolean
  activeNoteModified: boolean
  onSetViewMode: (mode: ViewMode) => void
  onToggleInspector: () => void
  onToggleDiff?: () => void
  onToggleRawEditor?: () => void
  noteLayout?: NoteLayout
  onToggleNoteLayout?: () => void
  onToggleAIChat?: () => void
  zoomLevel: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onCustomizeNoteListColumns?: () => void
  canCustomizeNoteListColumns?: boolean
  noteListColumnsLabel: string
}

function buildNoteLayoutCommand(noteLayout: NoteLayout, onToggleNoteLayout?: () => void): CommandAction {
  return {
    id: 'toggle-note-layout',
    label: NOTE_LAYOUT_COMMAND_LABELS[noteLayout],
    group: 'View',
    keywords: ['layout', 'note', 'column', 'wide', 'left', 'centered', 'reading'],
    enabled: Boolean(onToggleNoteLayout),
    execute: onToggleNoteLayout ?? noop,
  }
}

export function buildViewCommands(config: ViewCommandsConfig): CommandAction[] {
  const {
    hasActiveNote, activeNoteModified,
    onSetViewMode, onToggleInspector, onToggleDiff, onToggleRawEditor, noteLayout = 'centered', onToggleNoteLayout, onToggleAIChat,
    zoomLevel, onZoomIn, onZoomOut, onZoomReset,
    onCustomizeNoteListColumns, canCustomizeNoteListColumns, noteListColumnsLabel,
  } = config

  return [
    { id: 'view-editor', label: 'Editor Only', group: 'View', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewEditorOnly), keywords: ['layout', 'focus'], enabled: true, execute: () => onSetViewMode('editor-only') },
    { id: 'view-editor-list', label: 'Editor + Note List', group: 'View', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewEditorList), keywords: ['layout'], enabled: true, execute: () => onSetViewMode('editor-list') },
    { id: 'view-all', label: 'Full Layout', group: 'View', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewAll), keywords: ['layout', 'sidebar'], enabled: true, execute: () => onSetViewMode('all') },
    { id: 'toggle-inspector', label: 'Toggle Properties Panel', group: 'View', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewToggleProperties), keywords: ['properties', 'inspector', 'panel', 'right', 'sidebar'], enabled: true, execute: onToggleInspector },
    { id: 'toggle-diff', label: 'Toggle Diff Mode', group: 'View', keywords: ['diff', 'changes', 'git', 'compare', 'version'], enabled: hasActiveNote && activeNoteModified, execute: () => onToggleDiff?.() },
    { id: 'toggle-raw-editor', label: 'Toggle Raw Editor', group: 'View', keywords: ['raw', 'source', 'markdown', 'frontmatter', 'code', 'textarea'], enabled: hasActiveNote && !!onToggleRawEditor, execute: () => onToggleRawEditor?.() },
    buildNoteLayoutCommand(noteLayout, onToggleNoteLayout),
    { id: 'toggle-ai-panel', label: 'Toggle AI Panel', group: 'View', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewToggleAiChat), keywords: ['ai', 'agent', 'chat', 'assistant', 'contextual'], enabled: true, execute: () => onToggleAIChat?.() },
    { id: 'new-ai-chat', label: 'New AI chat', group: 'View', keywords: ['ai', 'agent', 'chat', 'assistant', 'new', 'fresh', 'conversation', 'reset'], enabled: true, execute: requestNewAiChat },
    { id: 'toggle-backlinks', label: 'Toggle Backlinks', group: 'View', keywords: ['backlinks', 'references', 'links', 'mentions', 'incoming'], enabled: hasActiveNote, execute: onToggleInspector },
    { id: 'customize-note-list-columns', label: noteListColumnsLabel, group: 'View', keywords: ['all notes', 'inbox', 'columns', 'chips', 'properties', 'note list'], enabled: !!(canCustomizeNoteListColumns && onCustomizeNoteListColumns), execute: () => onCustomizeNoteListColumns?.() },
    { id: 'zoom-in', label: `Zoom In (${zoomLevel}%)`, group: 'View', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewZoomIn), keywords: ['zoom', 'bigger', 'larger', 'scale'], enabled: zoomLevel < 150, execute: onZoomIn },
    { id: 'zoom-out', label: `Zoom Out (${zoomLevel}%)`, group: 'View', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewZoomOut), keywords: ['zoom', 'smaller', 'scale'], enabled: zoomLevel > 80, execute: onZoomOut },
    { id: 'zoom-reset', label: 'Reset Zoom', group: 'View', shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewZoomReset), keywords: ['zoom', 'actual', 'default', '100'], enabled: zoomLevel !== 100, execute: onZoomReset },
  ]
}
