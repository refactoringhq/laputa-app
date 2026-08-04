import type { RefObject, ReactNode } from 'react'
import { ClipboardText, FolderOpen, FolderPlus, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { translate, type AppLocale } from '../../lib/i18n'
import { getContextMenuPositionStyle } from '../contextMenuPosition'

const FOLDER_CONTEXT_MENU_MIN_WIDTH = 'min(11.25rem, calc(100vw - 16px))'
const FOLDER_CONTEXT_MENU_MAX_WIDTH = 'min(22rem, calc(100vw - 16px))'

const folderContextMenuSurfaceClass = 'fixed z-50 w-max min-w-[min(11.25rem,calc(100vw-16px))] max-w-[min(22rem,calc(100vw-16px))] rounded-md border bg-popover p-1 shadow-md'
const folderContextMenuButtonClass = 'h-auto w-full max-w-full justify-start gap-2 px-2 py-1.5 text-sm'

export interface FolderContextMenuState {
  path: string
  rootPath?: string
  x: number
  y: number
}

interface FolderContextMenuProps {
  menu: FolderContextMenuState | null
  menuRef: RefObject<HTMLDivElement | null>
  onDelete?: (folderPath: string) => void
  onReveal?: (folderPath: string) => void
  onCopyPath?: (folderPath: string) => void
  onCreateFolder?: (folderPath: string, rootPath?: string) => void
  onCreateNote?: (folderPath: string, rootPath?: string) => void
  onRename: (folderPath: string) => void
  locale?: AppLocale
}

function FolderMenuLabel({ children }: { children: ReactNode }) {
  return <span className="min-w-0 flex-1 truncate text-left">{children}</span>
}

function FolderMenuAction({
  destructive = false,
  icon,
  label,
  onClick,
  testId,
}: {
  destructive?: boolean
  icon: ReactNode
  label: ReactNode
  onClick: () => void
  testId?: string
}) {
  const className = destructive
    ? `${folderContextMenuButtonClass} text-destructive hover:text-destructive`
    : folderContextMenuButtonClass
  return (
    <Button type="button" variant="ghost" className={className} onClick={onClick} data-testid={testId}>
      {icon}
      <FolderMenuLabel>{label}</FolderMenuLabel>
    </Button>
  )
}

export function FolderContextMenu(props: FolderContextMenuProps) {
  const {
    menu,
    menuRef,
    onDelete,
    onReveal,
    onCopyPath,
    onCreateFolder,
    onCreateNote,
    onRename,
    locale = 'en',
  } = props

  if (!menu) return null
  const canMutateFolder = menu.path.length > 0

  return (
    <div
      ref={menuRef}
      className={folderContextMenuSurfaceClass}
      style={getContextMenuPositionStyle(menu, {
        maxWidth: FOLDER_CONTEXT_MENU_MAX_WIDTH,
        minWidth: FOLDER_CONTEXT_MENU_MIN_WIDTH,
      })}
      data-testid="folder-context-menu"
    >
      {onCreateNote && (
        <FolderMenuAction
          icon={<Plus size={14} className="shrink-0" />}
          label={translate(locale, 'sidebar.action.createNoteInFolderMenu')}
          onClick={() => onCreateNote(menu.path, menu.rootPath)}
          testId="create-note-in-folder-menu-item"
        />
      )}
      {onCreateFolder && (
        <FolderMenuAction icon={<FolderPlus size={14} className="shrink-0" />} label={translate(locale, 'sidebar.action.createFolderInFolderMenu')} onClick={() => onCreateFolder(menu.path, menu.rootPath)} testId="create-folder-in-folder-menu-item" />
      )}
      {onReveal && (
        <FolderMenuAction icon={<FolderOpen size={14} className="shrink-0" />} label={translate(locale, 'sidebar.action.revealFolderMenu')} onClick={() => onReveal(menu.path)} testId="reveal-folder-menu-item" />
      )}
      {onCopyPath && (
        <FolderMenuAction icon={<ClipboardText size={14} className="shrink-0" />} label={translate(locale, 'sidebar.action.copyFolderPathMenu')} onClick={() => onCopyPath(menu.path)} testId="copy-folder-path-menu-item" />
      )}
      {canMutateFolder && (
        <FolderMenuAction icon={<PencilSimple size={14} className="shrink-0" />} label={translate(locale, 'sidebar.action.renameFolderMenu')} onClick={() => onRename(menu.path)} />
      )}
      {canMutateFolder && (
        <FolderMenuAction destructive icon={<Trash size={14} className="shrink-0" />} label={translate(locale, 'sidebar.action.deleteFolderMenu')} onClick={() => onDelete?.(menu.path)} testId="delete-folder-menu-item" />
      )}
    </div>
  )
}
