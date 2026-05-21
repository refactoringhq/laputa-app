import type { RefObject } from 'react'
import { Archive, ArrowSquareOut, MapTrifold, Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { translate, type AppLocale } from '../../lib/i18n'
import { trackEvent } from '../../lib/telemetry'
import type { VaultEntry } from '../../types'
import type { NoteListContextMenuState } from './NoteListContextMenu'

export function NoteListContextMenuNode({
  ctxMenu,
  ctxMenuRef,
  locale,
  onEnterNeighborhood,
  onOpenInNewWindow,
  onArchivePaths,
  onDeletePaths,
  onClose,
}: {
  ctxMenu: NoteListContextMenuState | null
  ctxMenuRef: RefObject<HTMLDivElement | null>
  locale: AppLocale
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onOpenInNewWindow?: (entry: VaultEntry) => void
  onArchivePaths?: (paths: string[]) => void
  onDeletePaths?: (paths: string[]) => void
  onClose: () => void
}) {
  if (!ctxMenu) return null

  const { entry } = ctxMenu
  const selectAction = (action: string, run: () => void) => {
    trackEvent('note_item_context_menu_action', { action })
    onClose()
    run()
  }

  return (
    <div
      ref={ctxMenuRef}
      className="fixed z-50 rounded-md border bg-popover p-1 shadow-md"
      style={{ left: ctxMenu.x, top: ctxMenu.y, minWidth: 210 }}
      data-testid="note-list-context-menu"
    >
      {onOpenInNewWindow && (
        <Button
          type="button"
          variant="ghost"
          className="flex h-auto w-full cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => selectAction('open_new_window', () => onOpenInNewWindow(entry))}
        >
          <ArrowSquareOut size={16} />
          {translate(locale, 'command.note.openNewWindow')}
        </Button>
      )}
      {onEnterNeighborhood && entry.fileKind !== 'binary' && (
        <Button
          type="button"
          variant="ghost"
          className="flex h-auto w-full cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => selectAction('open_neighborhood', () => onEnterNeighborhood(entry))}
        >
          <MapTrifold size={16} />
          {translate(locale, 'editor.toolbar.openNeighborhood')}
        </Button>
      )}
      {onArchivePaths && !entry.archived && (
        <Button
          type="button"
          variant="ghost"
          className="flex h-auto w-full cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => selectAction('archive', () => onArchivePaths([entry.path]))}
        >
          <Archive size={16} />
          {translate(locale, 'editor.toolbar.archive')}
        </Button>
      )}
      {onDeletePaths && (
        <Button
          type="button"
          variant="ghost"
          className="flex h-auto w-full cursor-default items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => selectAction('delete', () => onDeletePaths([entry.path]))}
        >
          <Trash size={16} />
          {translate(locale, 'editor.toolbar.delete')}
        </Button>
      )}
    </div>
  )
}
