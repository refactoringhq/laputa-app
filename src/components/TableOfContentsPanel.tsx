import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { ListBullets, TextHOne, TextHThree, TextHTwo, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { trackEvent } from '../lib/telemetry'
import type { AppLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'
import type { VaultEntry } from '../types'
import {
  buildTableOfContents,
  resolveTocItemBlockId,
  type TocItem,
} from './tableOfContentsModel'
import { buildTableOfContentsInWorker, TOC_BUILD_DEBOUNCE_MS } from './tableOfContentsWorkerClient'
import {
  FOLDER_ROW_CONTENT_INSET,
  getFolderConnectorLeft,
  getFolderDepthIndent,
} from './folder-tree/folderTreeLayout'

interface TableOfContentsEditor {
  document?: unknown[]
  focus?: () => void
  setTextCursorPosition?: (targetBlock: string, placement?: 'start' | 'end') => void
}

interface TableOfContentsPanelProps {
  editor: TableOfContentsEditor
  entry: VaultEntry | null
  locale?: AppLocale
  onClose: () => void
  sourceContent?: string | null
}

interface TocState {
  noteKey: string
  toc: TocItem
}

interface DebouncedTocOptions {
  editor: TableOfContentsEditor
  noteKey: string
  sourceContent?: string | null
  title: string
  titleOnlyToc: TocItem
}

function HeadingIcon({ level }: { level: TocItem['level'] }) {
  const className = 'size-[17px] shrink-0 text-muted-foreground'
  if (level === 1) return <TextHOne size={17} className={className} />
  if (level === 2) return <TextHTwo size={17} className={className} />
  return <TextHThree size={17} className={className} />
}

function buildTitleOnlyToc(title: string): TocItem {
  return { id: 'toc-title', level: 1, title, children: [] }
}

function noteKeyForEntry(entry: VaultEntry | null, title: string): string {
  return `${entry?.path ?? ''}:${title}`
}

function cssAttributeValue(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&')
}

function scrollBlockIntoView(blockId: string) {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(`[data-id="${cssAttributeValue(blockId)}"]`)
      ?.scrollIntoView?.({ block: 'center' })
  })
}

function useDebouncedToc({
  editor,
  noteKey,
  sourceContent,
  title,
  titleOnlyToc,
}: DebouncedTocOptions): TocItem {
  const [tocState, setTocState] = useState<TocState>(() => ({
    noteKey,
    toc: titleOnlyToc,
  }))

  useEffect(() => {
    if (sourceContent === undefined) return undefined

    let cancelled = false
    const timeout = window.setTimeout(() => {
      void buildTableOfContentsInWorker(title, sourceContent ?? '')
        .then((nextToc) => {
          if (!cancelled) setTocState({ noteKey, toc: nextToc })
        })
        .catch(() => {
          if (!cancelled) setTocState({ noteKey, toc: titleOnlyToc })
        })
    }, TOC_BUILD_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [noteKey, sourceContent, title, titleOnlyToc])

  useEffect(() => {
    if (sourceContent !== undefined) return undefined

    const timeout = window.setTimeout(() => {
      setTocState({ noteKey, toc: buildTableOfContents(title, editor.document ?? []) })
    }, TOC_BUILD_DEBOUNCE_MS)

    return () => window.clearTimeout(timeout)
  }, [editor.document, noteKey, sourceContent, title])

  return tocState.noteKey === noteKey ? tocState.toc : titleOnlyToc
}

function useTocNavigation(editor: TableOfContentsEditor, title: string) {
  return useCallback((item: TocItem) => {
    const blockId = resolveTocItemBlockId(title, item, editor.document ?? [])
    if (!blockId) return

    try {
      editor.setTextCursorPosition?.(blockId, 'start')
    } catch {
      // BlockNote can transiently reject selection while a note swap settles.
    }
    editor.focus?.()
    scrollBlockIntoView(blockId)
    trackEvent('table_of_contents_heading_selected')
  }, [editor, title])
}

function TocRow({
  depth,
  item,
  onNavigate,
}: {
  depth: number
  item: TocItem
  onNavigate: (item: TocItem) => void
}) {
  const hasChildren = item.children.length > 0
  const depthIndent = getFolderDepthIndent(depth)
  const contentInset = FOLDER_ROW_CONTENT_INSET

  return (
    <div
      className="group relative flex items-center gap-1 rounded text-foreground transition-colors hover:bg-accent"
      style={{ paddingLeft: depthIndent, borderRadius: 4 }}
    >
      <Button
        type="button"
        variant="ghost"
        className="h-auto flex-1 justify-start gap-2 rounded text-left text-[13px] font-medium text-foreground hover:bg-transparent hover:text-foreground"
        style={{
          paddingTop: 6,
          paddingBottom: 6,
          paddingLeft: contentInset,
          paddingRight: 16,
        }}
        title={item.title}
        aria-expanded={hasChildren ? true : undefined}
        onClick={() => onNavigate(item)}
      >
        <HeadingIcon level={item.level} />
        <span className="truncate">{item.title}</span>
      </Button>
    </div>
  )
}

function TocChildren({
  depth,
  item,
  onNavigate,
}: {
  depth: number
  item: TocItem
  onNavigate: (item: TocItem) => void
}) {
  if (item.children.length === 0) return null

  return (
    <div className="relative" data-testid={`toc-children:${item.id}`}>
      <div
        className="absolute top-0 bottom-0 bg-border"
        data-testid={`toc-connector:${item.id}`}
        style={{ left: getFolderConnectorLeft(depth), width: 1 }}
      />
      {item.children.map((child) => (
        <TocItemNode
          key={child.id}
          depth={depth + 1}
          item={child}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  )
}

function TocItemNode({
  depth,
  item,
  onNavigate,
}: {
  depth: number
  item: TocItem
  onNavigate: (item: TocItem) => void
}) {
  return (
    <>
      <TocRow
        depth={depth}
        item={item}
        onNavigate={onNavigate}
      />
      <TocChildren
        depth={depth}
        item={item}
        onNavigate={onNavigate}
      />
    </>
  )
}

function TableOfContentsHeader({ locale = 'en', onClose }: Pick<TableOfContentsPanelProps, 'locale' | 'onClose'>) {
  return (
    <div
      className="flex shrink-0 items-center border-b border-border"
      style={{ height: 52, padding: '6px 12px', gap: 8, cursor: 'default' }}
    >
      <ListBullets size={16} className="shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground" style={{ fontSize: 13, fontWeight: 600 }}>
        {translate(locale, 'tableOfContents.title')}
      </span>
      <span className="flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={onClose}
        aria-label={translate(locale, 'tableOfContents.close')}
        title={translate(locale, 'tableOfContents.close')}
      >
        <X size={16} />
      </Button>
    </div>
  )
}

export const TableOfContentsPanel = memo(function TableOfContentsPanel({
  editor,
  entry,
  locale = 'en',
  onClose,
  sourceContent,
}: TableOfContentsPanelProps) {
  const title = entry?.title ?? translate(locale, 'tableOfContents.untitledHeading')
  const noteKey = noteKeyForEntry(entry, title)
  const titleOnlyToc = useMemo(() => buildTitleOnlyToc(title), [title])
  const toc = useDebouncedToc({
    editor,
    noteKey,
    sourceContent,
    title,
    titleOnlyToc,
  })
  const navigateToItem = useTocNavigation(editor, title)

  return (
    <aside className="flex flex-1 flex-col overflow-hidden border-l border-border bg-background text-foreground">
      <TableOfContentsHeader locale={locale} onClose={onClose} />
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3" data-testid="table-of-contents-panel">
        <TocItemNode
          depth={0}
          item={toc}
          onNavigate={navigateToItem}
        />
      </div>
    </aside>
  )
})
