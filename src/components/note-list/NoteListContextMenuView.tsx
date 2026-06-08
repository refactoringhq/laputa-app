import type { RefObject } from 'react'
import {
  Archive,
  ArrowSquareOut,
  CheckCircle,
  ClipboardText,
  FilePdf,
  FolderOpen,
  GitBranch,
  MapTrifold,
  Star,
  Trash,
  type Icon,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../../hooks/appCommandCatalog'
import { translate, type AppLocale } from '../../lib/i18n'
import { trackEvent } from '../../lib/telemetry'
import type { VaultEntry } from '../../types'
import { isMarkdownEntry } from '../../utils/typeDefinitions'
import type { NoteListContextMenuState } from './NoteListContextMenu'

interface NoteListContextMenuItem {
  destructive?: boolean
  icon: Icon
  iconWeight?: 'bold' | 'fill' | 'regular'
  label: string
  onSelect: () => void
  shortcut?: string
}

type SelectContextAction = (action: string, run: () => void) => void

interface NoteListContextMenuNodeProps {
  ctxMenu: NoteListContextMenuState | null
  ctxMenuRef: RefObject<HTMLDivElement | null>
  locale: AppLocale
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onOpenInNewWindow?: (entry: VaultEntry) => void
  onArchivePaths?: (paths: string[]) => void
  onDeletePaths?: (paths: string[]) => void
  onExportPdf?: (entry: VaultEntry) => void
  onToggleFavorite?: (path: string) => void
  onToggleOrganized?: (path: string) => void
  onRevealFile?: (path: string) => void
  onCopyFilePath?: (path: string) => void
  canCopyGitUrl?: (entry: VaultEntry) => boolean
  onCopyGitUrl?: (entry: VaultEntry) => void
  onClose: () => void
}

type BuildContextMenuItemsParams = Pick<
  NoteListContextMenuNodeProps,
  | 'locale'
  | 'onEnterNeighborhood'
  | 'onOpenInNewWindow'
  | 'onArchivePaths'
  | 'onDeletePaths'
  | 'onExportPdf'
  | 'onToggleFavorite'
  | 'onToggleOrganized'
  | 'onRevealFile'
  | 'onCopyFilePath'
  | 'canCopyGitUrl'
  | 'onCopyGitUrl'
>

function openWindowItem(
  entry: VaultEntry,
  locale: AppLocale,
  onOpenInNewWindow: ((entry: VaultEntry) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onOpenInNewWindow) return []
  return [{
    icon: ArrowSquareOut,
    label: translate(locale, 'command.note.openNewWindow'),
    onSelect: () => selectAction('open_new_window', () => onOpenInNewWindow(entry)),
    shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteOpenInNewWindow),
  }]
}

function favoriteItem(
  entry: VaultEntry,
  locale: AppLocale,
  onToggleFavorite: ((path: string) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onToggleFavorite) return []
  return [{
    icon: Star,
    iconWeight: entry.favorite ? 'fill' as const : 'regular' as const,
    label: translate(locale, entry.favorite ? 'command.note.removeFavorite' : 'command.note.addFavorite'),
    onSelect: () => selectAction('toggle_favorite', () => onToggleFavorite(entry.path)),
    shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteToggleFavorite),
  }]
}

function organizedItem(
  entry: VaultEntry,
  locale: AppLocale,
  onToggleOrganized: ((path: string) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onToggleOrganized) return []
  return [{
    icon: CheckCircle,
    iconWeight: entry.organized ? 'fill' as const : 'regular' as const,
    label: translate(locale, entry.organized ? 'command.note.markUnorganized' : 'command.note.markOrganized'),
    onSelect: () => selectAction('toggle_organized', () => onToggleOrganized(entry.path)),
    shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteToggleOrganized),
  }]
}

function neighborhoodItem(
  entry: VaultEntry,
  locale: AppLocale,
  onEnterNeighborhood: ((entry: VaultEntry) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onEnterNeighborhood || entry.fileKind === 'binary') return []
  return [{
    icon: MapTrifold,
    label: translate(locale, 'editor.toolbar.openNeighborhood'),
    onSelect: () => selectAction('open_neighborhood', () => onEnterNeighborhood(entry)),
  }]
}

function revealFileItem(
  entry: VaultEntry,
  locale: AppLocale,
  onRevealFile: ((path: string) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onRevealFile) return []
  return [{
    icon: FolderOpen,
    label: translate(locale, 'editor.toolbar.revealFile'),
    onSelect: () => selectAction('reveal_file', () => onRevealFile(entry.path)),
  }]
}

function copyFilePathItem(
  entry: VaultEntry,
  locale: AppLocale,
  onCopyFilePath: ((path: string) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onCopyFilePath) return []
  return [{
    icon: ClipboardText,
    label: translate(locale, 'editor.toolbar.copyFilePath'),
    onSelect: () => selectAction('copy_file_path', () => onCopyFilePath(entry.path)),
  }]
}

function copyGitUrlItem(
  entry: VaultEntry,
  locale: AppLocale,
  canCopyGitUrl: ((entry: VaultEntry) => boolean) | undefined,
  onCopyGitUrl: ((entry: VaultEntry) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onCopyGitUrl || !canCopyGitUrl?.(entry)) return []
  return [{
    icon: GitBranch,
    label: translate(locale, 'editor.toolbar.copyNoteGitUrl'),
    onSelect: () => selectAction('copy_git_url', () => onCopyGitUrl(entry)),
  }]
}

function exportPdfItem(
  entry: VaultEntry,
  locale: AppLocale,
  onExportPdf: ((entry: VaultEntry) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onExportPdf || !isMarkdownEntry(entry)) return []
  return [{
    icon: FilePdf,
    label: translate(locale, 'editor.toolbar.exportPdf'),
    onSelect: () => selectAction('export_pdf', () => onExportPdf(entry)),
    shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteExportPdf),
  }]
}

function archiveItem(
  entry: VaultEntry,
  locale: AppLocale,
  onArchivePaths: ((paths: string[]) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onArchivePaths || entry.archived) return []
  return [{
    icon: Archive,
    label: translate(locale, 'editor.toolbar.archive'),
    onSelect: () => selectAction('archive', () => onArchivePaths([entry.path])),
  }]
}

function deleteItem(
  entry: VaultEntry,
  locale: AppLocale,
  onDeletePaths: ((paths: string[]) => void) | undefined,
  selectAction: SelectContextAction,
) {
  if (!onDeletePaths) return []
  return [{
    destructive: true,
    icon: Trash,
    label: translate(locale, 'editor.toolbar.delete'),
    onSelect: () => selectAction('delete', () => onDeletePaths([entry.path])),
    shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.noteDelete),
  }]
}

function buildContextMenuItems(
  props: BuildContextMenuItemsParams,
  entry: VaultEntry,
  selectAction: SelectContextAction,
): NoteListContextMenuItem[] {
  return [
    ...openWindowItem(entry, props.locale, props.onOpenInNewWindow, selectAction),
    ...favoriteItem(entry, props.locale, props.onToggleFavorite, selectAction),
    ...organizedItem(entry, props.locale, props.onToggleOrganized, selectAction),
    ...neighborhoodItem(entry, props.locale, props.onEnterNeighborhood, selectAction),
    ...revealFileItem(entry, props.locale, props.onRevealFile, selectAction),
    ...copyFilePathItem(entry, props.locale, props.onCopyFilePath, selectAction),
    ...copyGitUrlItem(entry, props.locale, props.canCopyGitUrl, props.onCopyGitUrl, selectAction),
    ...exportPdfItem(entry, props.locale, props.onExportPdf, selectAction),
    ...archiveItem(entry, props.locale, props.onArchivePaths, selectAction),
    ...deleteItem(entry, props.locale, props.onDeletePaths, selectAction),
  ]
}

function NoteListContextMenuButton({ item }: { item: NoteListContextMenuItem }) {
  const IconComponent = item.icon
  return (
    <Button
      type="button"
      variant="ghost"
      className={`flex h-auto w-full cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground ${item.destructive ? 'text-destructive hover:text-destructive' : ''}`}
      onClick={item.onSelect}
    >
      <IconComponent size={16} weight={item.iconWeight} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
      {item.shortcut && <span className="ml-4 shrink-0 text-xs text-muted-foreground">{item.shortcut}</span>}
    </Button>
  )
}

export function NoteListContextMenuNode({
  ctxMenu,
  ctxMenuRef,
  locale,
  onEnterNeighborhood,
  onOpenInNewWindow,
  onArchivePaths,
  onDeletePaths,
  onExportPdf,
  onToggleFavorite,
  onToggleOrganized,
  onRevealFile,
  onCopyFilePath,
  canCopyGitUrl,
  onCopyGitUrl,
  onClose,
}: NoteListContextMenuNodeProps) {
  if (!ctxMenu) return null

  const { entry } = ctxMenu
  const selectAction = (action: string, run: () => void) => {
    trackEvent('note_item_context_menu_action', { action })
    onClose()
    run()
  }
  const items = buildContextMenuItems({
    locale,
    onEnterNeighborhood,
    onOpenInNewWindow,
    onArchivePaths,
    onDeletePaths,
    onExportPdf,
    onToggleFavorite,
    onToggleOrganized,
    onRevealFile,
    onCopyFilePath,
    canCopyGitUrl,
    onCopyGitUrl,
  }, entry, selectAction)

  return (
    <div
      ref={ctxMenuRef}
      className="fixed z-[12000] rounded-md border bg-popover p-1 shadow-md"
      style={{ left: ctxMenu.x, top: ctxMenu.y, minWidth: 240 }}
      data-testid="note-list-context-menu"
    >
      {items.map((item) => <NoteListContextMenuButton key={item.label} item={item} />)}
    </div>
  )
}
