import type { RefObject } from 'react'
import { ClipboardText, FolderOpen, FolderPlus, PencilSimple, Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { translate, type AppLocale } from '../../lib/i18n'

export interface FolderContextMenuState {
  path: string
  x: number
  y: number
}

interface FolderContextMenuProps {
  menu: FolderContextMenuState | null
  menuRef: RefObject<HTMLDivElement | null>
  onDelete?: (folderPath: string) => void
  onReveal?: (folderPath: string) => void
  onCopyPath?: (folderPath: string) => void
  onCreateSubfolder?: (folderPath: string) => void
  onRename: (folderPath: string) => void
  locale?: AppLocale
}

export function FolderContextMenu({
  menu,
  menuRef,
  onDelete,
  onReveal,
  onCopyPath,
  onCreateSubfolder,
  onRename,
  locale = 'en',
}: FolderContextMenuProps) {
  if (!menu) return null

  return (
    <div
      ref={menuRef}
      className="fixed z-50 rounded-md border bg-popover p-1 shadow-md"
      style={{ left: menu.x, top: menu.y, minWidth: 180 }}
      data-testid="folder-context-menu"
    >
      {onReveal && (
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm"
          onClick={() => onReveal(menu.path)}
          data-testid="reveal-folder-menu-item"
        >
          <FolderOpen size={14} />
          {translate(locale, 'sidebar.action.revealFolderMenu')}
        </Button>
      )}
      {onCopyPath && (
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm"
          onClick={() => onCopyPath(menu.path)}
          data-testid="copy-folder-path-menu-item"
        >
          <ClipboardText size={14} />
          {translate(locale, 'sidebar.action.copyFolderPathMenu')}
        </Button>
      )}
      {onCreateSubfolder && (
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm"
          onClick={() => onCreateSubfolder(menu.path)}
          data-testid="create-subfolder-menu-item"
        >
          <FolderPlus size={14} />
          {translate(locale, 'sidebar.action.createSubfolderMenu')}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm"
        onClick={() => onRename(menu.path)}
      >
        <PencilSimple size={14} />
        {translate(locale, 'sidebar.action.renameFolderMenu')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="h-auto w-full justify-start gap-2 px-2 py-1.5 text-sm text-destructive hover:text-destructive"
        onClick={() => onDelete?.(menu.path)}
        data-testid="delete-folder-menu-item"
      >
        <Trash size={14} />
        {translate(locale, 'sidebar.action.deleteFolderMenu')}
      </Button>
    </div>
  )
}
