import { useCallback, useMemo, useState } from 'react'
import { CaretDown, CaretRight, ListBullets, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDragRegion } from '../hooks/useDragRegion'
import { translate, type AppLocale } from '../lib/i18n'
import type { VaultEntry } from '../types'
import { extractTableOfContents, type TableOfContentsItem } from '../utils/tableOfContents'

interface TableOfContentsEditor {
  document: unknown
  focus: () => void
  setTextCursorPosition: (blockId: string, placement: 'start' | 'end') => void
}

interface TableOfContentsPanelProps {
  activeEntry: VaultEntry | null
  documentRevision: number
  editor: TableOfContentsEditor
  locale?: AppLocale
  onClose: () => void
  onHeadingSelected?: (item: TableOfContentsItem) => void
}

const EMPTY_COLLAPSED_IDS = new Set<string>()

function headingLabel(item: TableOfContentsItem, locale: AppLocale): string {
  return item.text || translate(locale, 'tableOfContents.untitledHeading')
}

function findBlockElement(blockId: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>('[data-id], [data-block-id]')
  for (const candidate of candidates) {
    if (candidate.dataset.id === blockId) return candidate
    if (candidate.dataset.blockId === blockId) return candidate
  }
  return null
}

function scrollHeadingIntoView(blockId: string) {
  findBlockElement(blockId)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function EmptyTableOfContents({ children }: { children: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  )
}

function TableOfContentsHeader({
  locale,
  onClose,
}: {
  locale: AppLocale
  onClose: () => void
}) {
  const { onMouseDown } = useDragRegion()

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-border px-3"
      style={{ height: 52 }}
      onMouseDown={onMouseDown}
    >
      <ListBullets size={16} className="shrink-0 text-muted-foreground" />
      <h2 className="m-0 truncate text-[13px] font-semibold text-muted-foreground">
        {translate(locale, 'tableOfContents.title')}
      </h2>
      <span className="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        aria-label={translate(locale, 'tableOfContents.close')}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onClose}
      >
        <X size={16} />
      </Button>
    </div>
  )
}

function ToggleChildrenButton({
  collapsed,
  item,
  locale,
  onToggle,
}: {
  collapsed: boolean
  item: TableOfContentsItem
  locale: AppLocale
  onToggle: (itemId: string) => void
}) {
  const label = headingLabel(item, locale)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="size-6 rounded-md text-muted-foreground hover:text-foreground"
      aria-label={translate(locale, collapsed ? 'tableOfContents.expandHeading' : 'tableOfContents.collapseHeading', { heading: label })}
      onClick={() => onToggle(item.id)}
    >
      {collapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
    </Button>
  )
}

function TogglePlaceholder() {
  return <span className="size-6 shrink-0" aria-hidden="true" />
}

function TableOfContentsNode({
  collapsedIds,
  depth,
  item,
  locale,
  onSelect,
  onToggle,
}: {
  collapsedIds: Set<string>
  depth: number
  item: TableOfContentsItem
  locale: AppLocale
  onSelect: (item: TableOfContentsItem) => void
  onToggle: (itemId: string) => void
}) {
  const collapsed = collapsedIds.has(item.id)
  const hasChildren = item.children.length > 0
  const label = headingLabel(item, locale)

  return (
    <li>
      <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 12 }}>
        {hasChildren
          ? <ToggleChildrenButton collapsed={collapsed} item={item} locale={locale} onToggle={onToggle} />
          : <TogglePlaceholder />}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-7 min-w-0 flex-1 justify-start rounded-md px-2 text-left text-[13px] font-normal text-muted-foreground hover:text-foreground',
            item.level === 1 && 'font-medium text-foreground',
          )}
          onClick={() => onSelect(item)}
        >
          <span className="truncate">{label}</span>
        </Button>
      </div>
      {hasChildren && !collapsed && (
        <ul className="m-0 list-none p-0">
          {item.children.map((child) => (
            <TableOfContentsNode
              key={child.id}
              collapsedIds={collapsedIds}
              depth={depth + 1}
              item={child}
              locale={locale}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function TableOfContentsTree({
  collapsedIds,
  items,
  locale,
  onSelect,
  onToggle,
}: {
  collapsedIds: Set<string>
  items: TableOfContentsItem[]
  locale: AppLocale
  onSelect: (item: TableOfContentsItem) => void
  onToggle: (itemId: string) => void
}) {
  return (
    <nav aria-label={translate(locale, 'tableOfContents.navLabel')} className="flex-1 overflow-y-auto p-2">
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {items.map((item) => (
          <TableOfContentsNode
            key={item.id}
            collapsedIds={collapsedIds}
            depth={0}
            item={item}
            locale={locale}
            onSelect={onSelect}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </nav>
  )
}

function useCollapsedHeadingState(activePath: string | null) {
  const [collapseState, setCollapseState] = useState<{ path: string | null; ids: Set<string> }>(() => ({
    path: null,
    ids: new Set(),
  }))
  const collapsedIds = collapseState.path === activePath ? collapseState.ids : EMPTY_COLLAPSED_IDS

  const handleToggle = useCallback((itemId: string) => {
    setCollapseState((current) => {
      const currentIds = current.path === activePath ? current.ids : EMPTY_COLLAPSED_IDS
      const next = new Set(currentIds)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return { path: activePath, ids: next }
    })
  }, [activePath])

  return { collapsedIds, handleToggle }
}

function TableOfContentsBody({
  activeEntry,
  collapsedIds,
  items,
  locale,
  onSelect,
  onToggle,
}: {
  activeEntry: VaultEntry | null
  collapsedIds: Set<string>
  items: TableOfContentsItem[]
  locale: AppLocale
  onSelect: (item: TableOfContentsItem) => void
  onToggle: (itemId: string) => void
}) {
  if (!activeEntry) {
    return <EmptyTableOfContents>{translate(locale, 'tableOfContents.emptyNoNote')}</EmptyTableOfContents>
  }

  if (items.length === 0) {
    return <EmptyTableOfContents>{translate(locale, 'tableOfContents.empty')}</EmptyTableOfContents>
  }

  return (
    <TableOfContentsTree
      collapsedIds={collapsedIds}
      items={items}
      locale={locale}
      onSelect={onSelect}
      onToggle={onToggle}
    />
  )
}

export function TableOfContentsPanel({
  activeEntry,
  documentRevision,
  editor,
  locale = 'en',
  onClose,
  onHeadingSelected,
}: TableOfContentsPanelProps) {
  const items = useMemo(
    () => extractTableOfContents(editor.document),
    [activeEntry?.path, documentRevision, editor],
  )
  const activePath = activeEntry?.path ?? null
  const { collapsedIds, handleToggle } = useCollapsedHeadingState(activePath)

  const handleSelect = useCallback((item: TableOfContentsItem) => {
    editor.focus()
    editor.setTextCursorPosition(item.id, 'start')
    scrollHeadingIntoView(item.id)
    onHeadingSelected?.(item)
  }, [editor, onHeadingSelected])

  return (
    <aside
      className="flex flex-1 flex-col overflow-hidden border-l border-border bg-background text-foreground"
      data-testid="table-of-contents-panel"
    >
      <TableOfContentsHeader locale={locale} onClose={onClose} />
      <TableOfContentsBody
        activeEntry={activeEntry}
        collapsedIds={collapsedIds}
        items={items}
        locale={locale}
        onSelect={handleSelect}
        onToggle={handleToggle}
      />
    </aside>
  )
}
