import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import type { AppLocale } from '../../lib/i18n'
import { trackEvent } from '../../lib/telemetry'
import type { VaultEntry } from '../../types'
import { NoteListContextMenuNode } from './NoteListContextMenuView'

export type NoteListContextMenuState = {
  x: number
  y: number
  entry: VaultEntry
}

interface NoteListContextMenuParams {
  locale?: AppLocale
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onOpenInNewWindow?: (entry: VaultEntry) => void
  onArchivePaths?: (paths: string[]) => void
  onDeletePaths?: (paths: string[]) => void
}

function hasNoteListContextActions({
  entry,
  onEnterNeighborhood,
  onOpenInNewWindow,
  onArchivePaths,
  onDeletePaths,
}: NoteListContextMenuParams & { entry: VaultEntry }) {
  return Boolean(
    onOpenInNewWindow
      || (onEnterNeighborhood && entry.fileKind !== 'binary')
      || (onArchivePaths && !entry.archived)
      || onDeletePaths,
  )
}

export function useNoteListContextMenu({
  locale = 'en',
  onEnterNeighborhood,
  onOpenInNewWindow,
  onArchivePaths,
  onDeletePaths,
}: NoteListContextMenuParams) {
  const [ctxMenu, setCtxMenu] = useState<NoteListContextMenuState | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  const closeContextMenu = useCallback(() => setCtxMenu(null), [])

  useEffect(() => {
    if (!ctxMenu) return

    const handleOutsideClick = (event: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(event.target as Node)) closeContextMenu()
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu()
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [ctxMenu, closeContextMenu])

  const handleNoteContextMenu = useCallback((entry: VaultEntry, event: ReactMouseEvent) => {
    if (!hasNoteListContextActions({ entry, onEnterNeighborhood, onOpenInNewWindow, onArchivePaths, onDeletePaths })) return
    event.preventDefault()
    event.stopPropagation()
    trackEvent('note_item_context_menu_opened')
    setCtxMenu({ x: event.clientX, y: event.clientY, entry })
  }, [onArchivePaths, onDeletePaths, onEnterNeighborhood, onOpenInNewWindow])

  const contextMenuNode = (
    <NoteListContextMenuNode
      ctxMenu={ctxMenu}
      ctxMenuRef={ctxMenuRef}
      locale={locale}
      onEnterNeighborhood={onEnterNeighborhood}
      onOpenInNewWindow={onOpenInNewWindow}
      onArchivePaths={onArchivePaths}
      onDeletePaths={onDeletePaths}
      onClose={closeContextMenu}
    />
  )

  return {
    handleNoteContextMenu,
    contextMenuNode,
  }
}
