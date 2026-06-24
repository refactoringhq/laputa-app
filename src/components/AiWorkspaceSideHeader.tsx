import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowsInLineHorizontal, ArrowsOutLineHorizontal, Plus, SidebarSimple, X } from '@phosphor-icons/react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { AgentStatus } from '../hooks/useCliAiAgent'
import { translate, type AppLocale } from '../lib/i18n'
import type { AiConversation } from './aiWorkspaceConversations'

function SideWorkspaceTitleEditor({
  conversation,
  locale,
  onCancel,
  onRename,
}: {
  conversation: AiConversation
  locale: AppLocale
  onCancel: () => void
  onRename: (title: string) => void
}) {
  const [draft, setDraft] = useState(conversation.title)
  const finishedRef = useRef(false)
  const submit = () => {
    if (finishedRef.current) return
    const nextTitle = draft.trim()
    if (!nextTitle) {
      finishedRef.current = true
      onCancel()
      return
    }

    finishedRef.current = true
    onRename(nextTitle)
    onCancel()
  }
  const cancel = () => {
    finishedRef.current = true
    onCancel()
  }

  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={submit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') submit()
        if (event.key === 'Escape') cancel()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      aria-label={translate(locale, 'ai.workspace.renameChat')}
      className="h-9 w-[180px] rounded-lg px-3 text-[13px] font-semibold"
      autoFocus
    />
  )
}

function SideWorkspaceTab({
  active,
  conversation,
  editing,
  locale,
  onClose,
  onCancelRename,
  onRename,
  onSelect,
  onStartRename,
  status,
}: {
  active: boolean
  conversation: AiConversation
  editing: boolean
  locale: AppLocale
  onClose: (id: string) => void
  onCancelRename: () => void
  onRename: (id: string, title: string) => void
  onSelect: (id: string) => void
  onStartRename: (id: string) => void
  status: AgentStatus | undefined
}) {
  const closeLabel = translate(locale, 'ai.workspace.closeChat', { title: conversation.title })
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: conversation.id, disabled: editing })

  return (
    <div
      ref={setNodeRef}
      className="group relative shrink-0"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.55 : 1,
      }}
    >
      {editing ? (
        <SideWorkspaceTitleEditor
          conversation={conversation}
          locale={locale}
          onCancel={onCancelRename}
          onRename={(title) => onRename(conversation.id, title)}
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-10 shrink-0 cursor-grab justify-start rounded-lg px-3 text-[13px] font-semibold active:cursor-grabbing',
            active
              ? 'bg-[var(--state-hover)] text-foreground'
              : 'text-muted-foreground hover:bg-[var(--state-hover)] hover:text-foreground',
          )}
          {...attributes}
          {...listeners}
          aria-pressed={active}
          onClick={() => onSelect(conversation.id)}
          onDoubleClick={(event) => {
            event.stopPropagation()
            onStartRename(conversation.id)
          }}
        >
          <span className="whitespace-nowrap">{conversation.title}</span>
          {(status === 'thinking' || status === 'tool-executing') && <span className="ml-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />}
        </Button>
      )}
      {!editing && (
        <>
          <div
            className={cn(
              'pointer-events-none absolute inset-y-1 right-0 w-9 rounded-r-lg opacity-0 transition-opacity',
              active
                ? 'bg-gradient-to-l from-[var(--state-hover)] via-[var(--state-hover)] to-transparent'
                : 'bg-gradient-to-l from-sidebar via-sidebar to-transparent group-hover:from-[var(--state-hover)] group-hover:via-[var(--state-hover)]',
              'group-hover:opacity-100 group-focus-within:opacity-100',
            )}
            aria-hidden
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              'pointer-events-none absolute top-1/2 right-1.5 z-10 h-6 w-6 -translate-y-1/2 rounded-md p-0 opacity-0 shadow-none transition-opacity',
              'bg-transparent text-foreground hover:bg-transparent hover:text-foreground',
              'group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100',
            )}
            aria-label={closeLabel}
            title={closeLabel}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onClose(conversation.id)
            }}
          >
            <X size={13} weight="bold" />
          </Button>
        </>
      )}
    </div>
  )
}

function useHorizontalScrollFades(dependencyKey: string) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [fades, setFades] = useState({ left: false, right: false })

  const updateFades = useCallback(() => {
    const element = scrollRef.current
    if (!element) return

    const maxScrollLeft = element.scrollWidth - element.clientWidth
    setFades({
      left: element.scrollLeft > 1,
      right: maxScrollLeft > 1 && element.scrollLeft < maxScrollLeft - 1,
    })
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    updateFades()
    if (!element) return

    element.addEventListener('scroll', updateFades, { passive: true })
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateFades)
    resizeObserver?.observe(element)
    if (element.firstElementChild) resizeObserver?.observe(element.firstElementChild)

    return () => {
      element.removeEventListener('scroll', updateFades)
      resizeObserver?.disconnect()
    }
  }, [dependencyKey, updateFades])

  return {
    scrollRef,
    showLeftFade: fades.left,
    showRightFade: fades.right,
  }
}

function SideWorkspaceTabs({
  activeId,
  conversations,
  locale,
  onCloseConversation,
  onNewChat,
  onRename,
  onReorder,
  onSelect,
  statuses,
}: {
  activeId: string
  conversations: AiConversation[]
  locale: AppLocale
  onCloseConversation: (id: string) => void
  onNewChat: () => void
  onRename: (id: string, title: string) => void
  onReorder: (activeId: string, overId: string) => void
  onSelect: (id: string) => void
  statuses: Record<string, AgentStatus>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const visibleConversations = conversations.filter((conversation) => !conversation.archived)
  const visibleConversationIds = visibleConversations.map((conversation) => conversation.id)
  const tabDependencyKey = visibleConversations
    .map((conversation) => `${conversation.id}:${conversation.title}`)
    .join('\0')
  const { scrollRef, showLeftFade, showRightFade } = useHorizontalScrollFades(tabDependencyKey)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const activeConversationId = String(event.active.id)
    const overConversationId = event.over ? String(event.over.id) : ''
    if (!overConversationId || activeConversationId === overConversationId) return

    onReorder(activeConversationId, overConversationId)
  }, [onReorder])

  return (
    <div className="relative min-w-0 flex-1">
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-testid="ai-workspace-side-tabs"
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="flex w-max items-center gap-1 py-1">
            <SortableContext items={visibleConversationIds} strategy={horizontalListSortingStrategy}>
              {visibleConversations.map((conversation) => (
                <SideWorkspaceTab
                  key={conversation.id}
                  active={conversation.id === activeId}
                  conversation={conversation}
                  editing={editingId === conversation.id}
                  locale={locale}
                  onCancelRename={() => setEditingId(null)}
                  onClose={onCloseConversation}
                  onRename={onRename}
                  onSelect={onSelect}
                  onStartRename={setEditingId}
                  status={statuses[conversation.id]}
                />
              ))}
            </SortableContext>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label={translate(locale, 'ai.workspace.newChat')}
              title={translate(locale, 'ai.workspace.newChat')}
              onClick={onNewChat}
            >
              <Plus size={17} />
            </Button>
          </div>
        </DndContext>
      </div>
      {showLeftFade && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-sidebar to-transparent"
          data-testid="ai-workspace-side-tabs-left-fade"
        />
      )}
      {showRightFade && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-sidebar to-transparent"
          data-testid="ai-workspace-side-tabs-right-fade"
        />
      )}
    </div>
  )
}

export function SideWorkspaceHeader({
  activeId,
  conversations,
  expanded,
  locale,
  onClose,
  onCloseConversation,
  onNewChat,
  onRename,
  onReorder,
  onSelect,
  onToggleExpanded,
  separated,
  statuses,
}: {
  activeId: string
  conversations: AiConversation[]
  expanded: boolean
  locale: AppLocale
  onClose: () => void
  onCloseConversation: (id: string) => void
  onNewChat: () => void
  onRename: (id: string, title: string) => void
  onReorder: (activeId: string, overId: string) => void
  onSelect: (id: string) => void
  onToggleExpanded: () => void
  separated: boolean
  statuses: Record<string, AgentStatus>
}) {
  const expandLabel = translate(locale, expanded ? 'ai.workspace.restorePanel' : 'ai.workspace.expandPanel')

  return (
    <div
      className={cn(
        'flex h-[52px] shrink-0 items-center gap-2 px-2',
        separated && 'border-b border-border',
      )}
      data-testid="ai-workspace-side-header"
    >
      <SideWorkspaceTabs
        activeId={activeId}
        conversations={conversations}
        locale={locale}
        onCloseConversation={onCloseConversation}
        onNewChat={onNewChat}
        onRename={onRename}
        onReorder={onReorder}
        onSelect={onSelect}
        statuses={statuses}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={expandLabel}
        title={expandLabel}
        onClick={onToggleExpanded}
      >
        {expanded ? <ArrowsInLineHorizontal size={17} /> : <ArrowsOutLineHorizontal size={17} />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={translate(locale, 'ai.workspace.close')}
        title={translate(locale, 'ai.workspace.close')}
        onClick={onClose}
      >
        <SidebarSimple size={17} weight="regular" />
      </Button>
    </div>
  )
}
