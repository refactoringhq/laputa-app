import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  CaretDown,
  CaretRight,
  Folder,
  FolderOpen,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { FolderNode } from '../../types'
import { useFolderRowInteractions } from './useFolderRowInteractions'
import { translate, type AppLocale } from '../../lib/i18n'

interface FolderItemRowProps {
  contentInset: number
  depthIndent: number
  isExpanded: boolean
  isSelected: boolean
  node: FolderNode
  onDeleteFolder?: (folderPath: string) => void
  onOpenMenu: (node: FolderNode, event: ReactMouseEvent<HTMLDivElement>) => void
  onSelect: () => void
  onStartRenameFolder?: (folderPath: string) => void
  onToggle: (path: string) => void
  locale?: AppLocale
}

export function FolderItemRow({
  contentInset,
  depthIndent,
  isExpanded,
  isSelected,
  node,
  onDeleteFolder,
  onOpenMenu,
  onSelect,
  onStartRenameFolder,
  onToggle,
  locale = 'en',
}: FolderItemRowProps) {
  const hasChildren = node.children.length > 0
  const expandLabel = translate(locale, isExpanded ? 'sidebar.folder.collapse' : 'sidebar.folder.expand', { name: node.name })
  const hasActions = !!onStartRenameFolder || !!onDeleteFolder
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
      <FolderToggleButton
        expandLabel={expandLabel}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        onToggle={() => onToggle(node.path)}
      />
      <FolderSelectButton
        contentInset={contentInset}
        hasActions={hasActions}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        isSelected={isSelected}
        node={node}
        onClick={handleSelectClick}
        onDoubleClick={handleRenameDoubleClick}
      />
      {hasActions && (
        <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          {onStartRenameFolder && (
            <FolderActionButton
              ariaLabel={translate(locale, 'sidebar.action.renameFolder')}
              testId={`rename-folder-btn:${node.path}`}
              title={translate(locale, 'sidebar.action.renameFolder')}
              onClick={() => {
                onSelect()
                onStartRenameFolder(node.path)
              }}
            >
              <PencilSimple size={12} />
            </FolderActionButton>
          )}
          {onDeleteFolder && (
            <FolderActionButton
              ariaLabel={translate(locale, 'sidebar.action.deleteFolder')}
              testId={`delete-folder-btn:${node.path}`}
              title={translate(locale, 'sidebar.action.deleteFolder')}
              destructive
              onClick={() => {
                onSelect()
                onDeleteFolder(node.path)
              }}
            >
              <Trash size={12} />
            </FolderActionButton>
          )}
        </div>
      )}
    </div>
  )
}

function FolderToggleButton({
  expandLabel,
  hasChildren,
  isExpanded,
  onToggle,
}: {
  expandLabel: string
  hasChildren: boolean
  isExpanded: boolean
  onToggle: () => void
}) {
  if (!hasChildren) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="h-6 w-4 shrink-0 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      aria-label={expandLabel}
    >
      {isExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
    </Button>
  )
}

function FolderActionButton({
  ariaLabel,
  children,
  destructive = false,
  onClick,
  testId,
  title,
}: {
  ariaLabel: string
  children: ReactNode
  destructive?: boolean
  onClick: () => void
  testId: string
  title: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={ariaLabel}
      title={title}
      className={cn(
        'h-5 w-5 rounded p-0 text-muted-foreground',
        destructive ? 'hover:text-destructive' : 'hover:text-foreground',
      )}
      data-testid={testId}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </Button>
  )
}

function FolderSelectButton({
  contentInset,
  hasActions,
  hasChildren,
  isExpanded,
  isSelected,
  node,
  onClick,
  onDoubleClick,
}: {
  contentInset: number
  hasActions: boolean
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
        paddingLeft: hasChildren ? 0 : contentInset,
        paddingRight: hasActions ? 48 : 16,
      }}
      title={node.path || node.name}
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
