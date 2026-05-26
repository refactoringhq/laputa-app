import { useRef, useEffect, type ComponentType, type MouseEvent, type PointerEvent, type SVGAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { scrollSelectedHTMLChildIntoView } from '../utils/domScroll'
import { NoteTitleIcon } from './NoteTitleIcon'
import { WorkspaceInitialsBadge } from './WorkspaceInitialsBadge'
import type { WorkspaceIdentity } from '../types'

export interface NoteSearchResultItem {
  title: string
  noteIcon?: string | null
  noteType?: string
  typeColor?: string
  typeLightColor?: string
  TypeIcon?: ComponentType<SVGAttributes<SVGSVGElement>>
  workspace?: WorkspaceIdentity | null
}

interface NoteSearchListProps<T extends NoteSearchResultItem> {
  items: T[]
  selectedIndex: number
  getItemKey: (item: T, index: number) => string
  onItemClick: (item: T, index: number) => void
  onItemHover?: (index: number) => void
  activateOnMouseDown?: boolean
  emptyMessage?: string
  className?: string
}

interface NoteSearchListItemProps<T extends NoteSearchResultItem> {
  item: T
  index: number
  selected: boolean
  onItemClick: (item: T, index: number) => void
  onItemHover?: (index: number) => void
  activateOnMouseDown?: boolean
}

function NoteSearchListItem<T extends NoteSearchResultItem>({
  item,
  index,
  selected,
  onItemClick,
  onItemHover,
  activateOnMouseDown,
}: NoteSearchListItemProps<T>) {
  const pressActivatedRef = useRef(false)

  const activateFromPress = (event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (!activateOnMouseDown) return

    event.stopPropagation()
    if (pressActivatedRef.current) return

    pressActivatedRef.current = true
    window.setTimeout(() => {
      pressActivatedRef.current = false
    }, 0)
    onItemClick(item, index)
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (activateOnMouseDown) {
      event.preventDefault()
      event.stopPropagation()
      return
    }

    onItemClick(item, index)
  }

  return (
    <div
      className={cn(
        'flex cursor-pointer items-center justify-between gap-2 transition-colors',
        selected ? 'bg-accent' : 'hover:bg-secondary',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 border-0 bg-transparent px-3 py-1.5 text-left"
        onPointerDownCapture={activateFromPress}
        onMouseDownCapture={activateFromPress}
        onClick={handleClick}
        onMouseEnter={() => onItemHover?.(index)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-sm text-foreground">
          {item.TypeIcon && (
            <item.TypeIcon
              width={14}
              height={14}
              className="shrink-0"
              style={item.typeColor ? { color: item.typeColor } : undefined}
            />
          )}
          <NoteTitleIcon icon={item.noteIcon} size={14} testId="note-search-item-icon" />
          <span className="truncate">{item.title}</span>
        </span>
        {(item.noteType || item.workspace) && (
          <span className="ml-2 flex shrink-0 items-center gap-1.5">
            {item.noteType && (
              <Badge
                variant="secondary"
                className="shrink-0 text-[11px]"
                style={item.typeColor ? { color: item.typeColor, backgroundColor: item.typeLightColor } : undefined}
              >
                {item.noteType}
              </Badge>
            )}
            <WorkspaceInitialsBadge workspace={item.workspace} testId="note-search-workspace-badge" />
          </span>
        )}
      </button>
    </div>
  )
}

export function NoteSearchList<T extends NoteSearchResultItem>({
  items,
  selectedIndex,
  getItemKey,
  onItemClick,
  onItemHover,
  activateOnMouseDown,
  emptyMessage = 'No results',
  className,
}: NoteSearchListProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollSelectedHTMLChildIntoView(listRef.current, selectedIndex)
  }, [selectedIndex])

  if (items.length === 0) {
    return (
      <div ref={listRef} className={cn('py-1', className)}>
        <div className="px-4 py-3 text-center text-[13px] text-muted-foreground">
          {emptyMessage}
        </div>
      </div>
    )
  }

  return (
    <div ref={listRef} className={cn('py-1', className)}>
      {items.map((item, i) => (
        <NoteSearchListItem
          key={getItemKey(item, i)}
          item={item}
          index={i}
          selected={i === selectedIndex}
          onItemClick={onItemClick}
          onItemHover={onItemHover}
          activateOnMouseDown={activateOnMouseDown}
        />
      ))}
    </div>
  )
}
