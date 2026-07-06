import { useCallback, type DragEventHandler, type MouseEvent as ReactMouseEvent, type MouseEventHandler } from 'react'
import {
  Folder,
  FolderOpen,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FolderNode } from '../../types'
import { useFolderRowInteractions } from './useFolderRowInteractions'
import { readDraggedNotePath } from '../../utils/noteDragDrop'

interface FolderItemRowProps {
  contentInset: number
  depthIndent: number
  isExpanded: boolean
  isSelected: boolean
  node: FolderNode
  onOpenMenu: (node: FolderNode, event: ReactMouseEvent<HTMLElement>) => void
  onSelect: () => void
  onStartRenameFolder?: (folderPath: string) => void
  onToggle: () => void
  canOpenMenu?: boolean
  onCanDropNote?: (notePath: string, folderPath: string) => boolean
  onMoveNoteToFolder?: (notePath: string, folderPath: string) => Promise<unknown> | unknown
}

function useFolderNoteDropHandlers({
  node,
  onCanDropNote,
  onMoveNoteToFolder,
}: Pick<FolderItemRowProps, 'node' | 'onCanDropNote' | 'onMoveNoteToFolder'>) {
  const canMoveDraggedNote = useCallback((dataTransfer: DataTransfer | null) => {
    const notePath = readDraggedNotePath(dataTransfer)
    return notePath && onCanDropNote?.(notePath, node.path) ? notePath : null
  }, [node.path, onCanDropNote])

  const onDragOver: DragEventHandler<HTMLButtonElement> = useCallback((event) => {
    if (!canMoveDraggedNote(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [canMoveDraggedNote])

  const onDrop: DragEventHandler<HTMLButtonElement> = useCallback((event) => {
    const notePath = canMoveDraggedNote(event.dataTransfer)
    if (!notePath) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    void onMoveNoteToFolder?.(notePath, node.path)
  }, [canMoveDraggedNote, node.path, onMoveNoteToFolder])

  return { onDragOver, onDrop }
}

export function FolderItemRow({
  contentInset,
  depthIndent,
  isExpanded,
  isSelected,
  node,
  onOpenMenu,
  onSelect,
  onStartRenameFolder,
  onToggle,
  canOpenMenu = true,
  onCanDropNote,
  onMoveNoteToFolder,
}: FolderItemRowProps) {
  const hasChildren = node.children.length > 0
  const { handleRenameDoubleClick, handleSelectClick } = useFolderRowInteractions({
    hasChildren,
    onRenameFolder: onStartRenameFolder ? () => onStartRenameFolder(node.path) : undefined,
    onSelect,
    onToggle,
  })
  const noteDropHandlers = useFolderNoteDropHandlers({ node, onCanDropNote, onMoveNoteToFolder })

  return (
    <div
      className={cn(
        'group relative flex items-center gap-1 rounded transition-colors',
        isSelected
          ? 'bg-[var(--accent-blue-light)] text-primary'
          : 'text-foreground hover:bg-accent',
      )}
      style={{ paddingLeft: depthIndent, borderRadius: 4 }}
    >
      <FolderSelectButton
        contentInset={contentInset}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        isSelected={isSelected}
        node={node}
        onClick={handleSelectClick}
        onContextMenu={(event) => {
          if (!canOpenMenu) {
            event.preventDefault()
            return
          }
          onSelect()
          onOpenMenu(node, event)
        }}
        onDoubleClick={handleRenameDoubleClick}
        onDragOver={noteDropHandlers.onDragOver}
        onDrop={noteDropHandlers.onDrop}
      />
    </div>
  )
}

function FolderSelectButton({
  contentInset,
  hasChildren,
  isExpanded,
  isSelected,
  node,
  onClick,
  onContextMenu,
  onDoubleClick,
  onDragOver,
  onDrop,
}: {
  contentInset: number
  hasChildren: boolean
  isExpanded: boolean
  isSelected: boolean
  node: FolderNode
  onClick: (clickDetail: number) => void
  onContextMenu: MouseEventHandler<HTMLButtonElement>
  onDoubleClick: () => void
  onDragOver: DragEventHandler<HTMLButtonElement>
  onDrop: DragEventHandler<HTMLButtonElement>
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-auto flex-1 justify-start gap-2 rounded text-left text-[13px] font-medium hover:bg-transparent',
        isSelected ? 'text-primary hover:text-primary' : 'text-foreground hover:text-foreground',
      )}
      style={{
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: contentInset,
        paddingRight: 16,
      }}
      title={node.path || node.name}
      aria-expanded={hasChildren ? isExpanded : undefined}
      onClick={(event) => onClick(event.detail)}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid={`folder-row:${node.path}`}
    >
      {isSelected || isExpanded ? (
        <FolderOpen size={17} weight="fill" className="size-[17px] shrink-0" />
      ) : (
        <Folder size={17} className="size-[17px] shrink-0" />
      )}
      <span className="truncate">{node.name}</span>
    </Button>
  )
}
