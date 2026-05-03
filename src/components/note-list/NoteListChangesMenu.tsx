import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import type { ModifiedFile, VaultEntry } from '../../types'
import type { AppLocale } from '../../lib/i18n'
import { ChangeConfirmDialog, ChangesContextMenuNode } from './NoteListChangesMenuView'

interface ChangesContextMenuParams {
  isChangesView: boolean
  onDiscardFile?: (relativePath: string) => Promise<void>
  modifiedFiles?: ModifiedFile[]
  locale?: AppLocale
}

type ChangeAction = 'discard' | 'restore'

export type ChangeActionTarget = {
  entry: VaultEntry
  action: ChangeAction
  relativePath: string
}

export type ChangesContextMenuState = {
  x: number
  y: number
  entry: VaultEntry
}

function resolveChangeActionTarget(
  entry: VaultEntry,
  modifiedFiles?: ModifiedFile[],
): ChangeActionTarget | null {
  const file = modifiedFiles?.find(
    (modified) => modified.path === entry.path || entry.path.endsWith('/' + modified.relativePath),
  )
  if (!file) return null
  return {
    entry,
    action: file.status === 'deleted' ? 'restore' : 'discard',
    relativePath: file.relativePath,
  }
}

export function useChangesContextMenu({
  isChangesView,
  onDiscardFile,
  modifiedFiles,
  locale = 'en',
}: ChangesContextMenuParams) {
  const [ctxMenu, setCtxMenu] = useState<ChangesContextMenuState | null>(null)
  const [actionTarget, setActionTarget] = useState<ChangeActionTarget | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  const resolveActionTarget = useCallback((entry: VaultEntry) => {
    return resolveChangeActionTarget(entry, modifiedFiles)
  }, [modifiedFiles])

  const openContextMenuForEntry = useCallback((entry: VaultEntry, point: { x: number; y: number }) => {
    if (!isChangesView || !onDiscardFile) return
    setCtxMenu({ x: point.x, y: point.y, entry })
  }, [isChangesView, onDiscardFile])

  const handleNoteContextMenu = useCallback((entry: VaultEntry, event: ReactMouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    openContextMenuForEntry(entry, { x: event.clientX, y: event.clientY })
  }, [openContextMenuForEntry])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  useEffect(() => {
    if (!ctxMenu) return
    const handleOutsideClick = (event: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(event.target as Node)) closeCtxMenu()
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [ctxMenu, closeCtxMenu])

  const handleChangeConfirm = useCallback(async () => {
    if (!actionTarget || !onDiscardFile) return
    await onDiscardFile(actionTarget.relativePath)
    setActionTarget(null)
  }, [actionTarget, onDiscardFile])

  const menuActionTarget = ctxMenu ? resolveActionTarget(ctxMenu.entry) : null

  const selectMenuAction = () => {
    if (!menuActionTarget) return
    setActionTarget(menuActionTarget)
    closeCtxMenu()
  }

  const contextMenuNode = (
    <ChangesContextMenuNode
      ctxMenu={ctxMenu}
      ctxMenuRef={ctxMenuRef}
      actionTarget={menuActionTarget}
      locale={locale}
      onSelect={selectMenuAction}
    />
  )

  const dialogNode = (
    <ChangeConfirmDialog
      actionTarget={actionTarget}
      locale={locale}
      onCancel={() => setActionTarget(null)}
      onConfirm={handleChangeConfirm}
    />
  )

  return {
    handleNoteContextMenu,
    openContextMenuForEntry,
    contextMenuNode,
    dialogNode,
  }
}
