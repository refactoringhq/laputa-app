import { useCallback, useMemo, useState } from 'react'
import type { VaultEntry, SidebarSelection } from '../../types'
import { TagPill } from '../TagsDropdown'
import { SidebarGroupHeader } from './SidebarGroupHeader'
import { SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM } from './sidebarStyles'
import { collectVaultTags, countTagEntries, buildTagTree, type TagTreeNode } from '../../utils/tagTree'
import { translate, type AppLocale } from '../../lib/i18n'
import { SidebarCountPill } from '../SidebarParts'

interface TagsSectionProps {
  entries: VaultEntry[]
  selection: SidebarSelection
  onSelect: (selection: SidebarSelection) => void
  collapsed: boolean
  onToggle: () => void
  locale?: AppLocale
}

export function TagsSection({
  entries,
  selection,
  onSelect,
  collapsed,
  onToggle,
  locale = 'en',
}: TagsSectionProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const tagTree = useMemo(() => {
    const tags = collectVaultTags(entries)
    return buildTagTree(tags, (tag) => countTagEntries(entries, tag))
  }, [entries])

  const flatItems = useMemo(() => {
    const result: FlatTreeItem[] = []
    flattenTree(tagTree, 0, result, expandedPaths)
    return result
  }, [tagTree, expandedPaths])

  const activeTag = selection.kind === 'tag' ? selection.tag : null

  if (tagTree.length === 0) return null

  return (
    <div className="border-b border-border" style={{ padding: '0 6px' }}>
      <SidebarGroupHeader
        label={translate(locale, 'sidebar.group.tags')}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed && (
        <div style={{ paddingBottom: SIDEBAR_SECTION_CONTENT_PADDING_BOTTOM }}>
          {flatItems.map((item) => (
            <TagTreeItem
              key={item.fullPath}
              item={item}
              isActive={activeTag === item.fullPath}
              onSelect={() => onSelect({ kind: 'tag', tag: item.fullPath })}
              onToggle={() => toggleExpand(item.fullPath)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FlatTreeItem {
  name: string
  fullPath: string
  depth: number
  count: number
  hasChildren: boolean
  isExpanded: boolean
}

function flattenTree(
  nodes: TagTreeNode[],
  depth: number,
  result: FlatTreeItem[],
  expandedPaths: Set<string>,
): void {
  for (const node of nodes) {
    const isExpanded = expandedPaths.has(node.fullPath)
    const hasChildren = node.children.length > 0
    result.push({
      name: node.name,
      fullPath: node.fullPath,
      depth,
      count: node.count,
      hasChildren,
      isExpanded: hasChildren && isExpanded,
    })
    if (hasChildren && isExpanded) {
      flattenTree(node.children, depth + 1, result, expandedPaths)
    }
  }
}

function TagTreeItem({
  item,
  isActive,
  onSelect,
  onToggle,
}: {
  item: FlatTreeItem
  isActive: boolean
  onSelect: () => void
  onToggle: () => void
}) {
  return (
    <div
      className="flex w-full cursor-pointer items-center gap-1 rounded transition-colors hover:bg-accent"
      style={{
        paddingLeft: 8 + item.depth * 16,
        paddingRight: 4,
        paddingTop: 2,
        paddingBottom: 2,
        backgroundColor: isActive ? 'var(--accent)' : undefined,
      }}
      onClick={(e) => {
        if (item.hasChildren) {
          // Click toggles expansion, double-click selects
          e.preventDefault()
          onToggle()
        } else {
          onSelect()
        }
      }}
      onDoubleClick={item.hasChildren ? onSelect : undefined}
    >
      {item.hasChildren && (
        <span
          className="flex size-4 shrink-0 cursor-pointer items-center justify-center text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          style={{ fontSize: 10 }}
        >
          {item.isExpanded ? '▾' : '▸'}
        </span>
      )}
      {!item.hasChildren && <span className="size-4 shrink-0" />}
      <span className="min-w-0 flex-1">
        <TagPill tag={item.name} />
      </span>
      <SidebarCountPill
        count={item.count}
        className={isActive ? 'text-primary-foreground' : 'text-muted-foreground'}
        compact
        style={{
          background: isActive ? 'var(--primary)' : 'var(--muted)',
        }}
      />
    </div>
  )
}
