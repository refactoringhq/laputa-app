import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Folder,
  FolderOpen,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FolderNode } from '../../types'
import { useFolderRowInteractions } from './useFolderRowInteractions'

interface FolderItemRowProps {
  contentInset: number
  depthIndent: number
  isExpanded: boolean
  isSelected: boolean
  node: FolderNode
  onOpenMenu: (node: FolderNode, event: ReactMouseEvent<HTMLDivElement>) => void
  onSelect: () => void
  onStartRenameFolder?: (folderPath: string) => void
  onToggle: (path: string) => void
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
}: FolderItemRowProps) {
  const hasChildren = node.children.length > 0
  const { handleRenameDoubleClick, handleSelectClick } = useFolderRowInteractions({
    hasChildren,
    onRenameFolder: onStartRenameFolder ? () => onStartRenameFolder(node.path) : undefined,
    onSelect,
    onToggle: () => onToggle(node.path),
  })

  return (
    <div
      className={cn(
        'group relative flex items-center gap-1 rounded transition-colors',
        isSelected
          ? 'bg-[var(--accent-blue-light)] text-primary'
          : 'text-foreground hover:bg-accent',
      )}
      style={{ paddingLeft: depthIndent, borderRadius: 4 }}
      onContextMenu={(event) => {
        onSelect()
        onOpenMenu(node, event)
      }}
    >
      <FolderSelectButton
        contentInset={contentInset}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        isSelected={isSelected}
        node={node}
        onClick={handleSelectClick}
        onDoubleClick={handleRenameDoubleClick}
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
  onDoubleClick,
}: {
  contentInset: number
  hasChildren: boolean
  isExpanded: boolean
  isSelected: boolean
  node: FolderNode
  onClick: (clickDetail: number) => void
  onDoubleClick: () => void
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
      onDoubleClick={onDoubleClick}
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
