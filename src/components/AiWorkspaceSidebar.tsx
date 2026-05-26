import { useRef, useState } from 'react'
import {
  Archive,
  ArrowSquareIn,
  Check,
  CircleNotch,
  Plus,
  Robot,
  SidebarSimple,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useDragRegion } from '../hooks/useDragRegion'
import { translate, type AppLocale } from '../lib/i18n'
import type { AgentStatus } from '../hooks/useCliAiAgent'
import type { AiConversation } from './AiWorkspace'

interface ConversationSidebarProps {
  activeId: string
  collapsed: boolean
  conversations: AiConversation[]
  locale: AppLocale
  onCanArchive: (conversation: AiConversation) => boolean
  onArchive: (id: string) => void
  onNewChat: () => void
  onRename: (id: string, title: string) => void
  onRestore: (id: string) => void
  onSelect: (id: string) => void
  onToggleCollapsed: () => void
  setShowArchived: (show: boolean) => void
  showArchived: boolean
  sidebarWidth: number
  statuses: Record<string, AgentStatus>
}

function isRunningStatus(status: AgentStatus | undefined): boolean {
  return status === 'thinking' || status === 'tool-executing'
}

function SidebarStatusIndicator({ status }: { status: AgentStatus | undefined }) {
  if (isRunningStatus(status)) {
    return <CircleNotch size={14} className="animate-spin text-muted-foreground" aria-hidden />
  }

  if (status === 'error') {
    return <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden />
  }

  return null
}

function SidebarHeader({
  collapsed,
  locale,
  onNewChat,
  onToggleCollapsed,
}: {
  collapsed: boolean
  locale: AppLocale
  onNewChat: () => void
  onToggleCollapsed: () => void
}) {
  const { dragRegionRef } = useDragRegion<HTMLDivElement>()
  const collapseLabel = translate(locale, collapsed ? 'ai.workspace.expandSidebar' : 'ai.workspace.collapseSidebar')

  return (
    <div
      ref={dragRegionRef}
      className={cn(
        'flex h-12 shrink-0 items-center border-b border-border px-2',
        collapsed ? 'justify-center' : 'justify-between',
      )}
      data-testid="ai-workspace-sidebar-header"
    >
      <div className="flex min-w-0 items-center gap-2" data-no-drag>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={collapseLabel}
          title={collapseLabel}
          onClick={onToggleCollapsed}
        >
          <SidebarSimple size={16} />
        </Button>
        {!collapsed && (
          <>
            <Robot size={16} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-[13px] font-semibold text-foreground">
              {translate(locale, 'ai.workspace.title')}
            </span>
          </>
        )}
      </div>
      {!collapsed && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={translate(locale, 'ai.workspace.newChat')}
          title={translate(locale, 'ai.workspace.newChat')}
          data-testid="ai-workspace-sidebar-new-chat"
          data-no-drag
          onClick={onNewChat}
        >
          <Plus size={16} />
        </Button>
      )}
    </div>
  )
}

function ConversationTitleEditor({
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
    <div className="flex min-w-0 flex-1 items-center gap-1 pr-7">
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={submit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit()
          if (event.key === 'Escape') cancel()
        }}
        aria-label={translate(locale, 'ai.workspace.renameChat')}
        className="h-7 min-w-0 flex-1 px-2 text-[12px]"
        autoFocus
      />
      <Check size={14} className="shrink-0 text-muted-foreground" />
    </div>
  )
}

function CollapsedConversationSidebar({ locale, onNewChat }: { locale: AppLocale; onNewChat: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 p-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={translate(locale, 'ai.workspace.newChat')}
        title={translate(locale, 'ai.workspace.newChat')}
        data-testid="ai-workspace-sidebar-new-chat"
        onClick={onNewChat}
      >
        <Plus size={16} />
      </Button>
    </div>
  )
}

function ConversationArchiveButton({
  disabled,
  conversationId,
  locale,
  onArchive,
  onRestore,
  showArchived,
}: {
  disabled: boolean
  conversationId: string
  locale: AppLocale
  onArchive: (id: string) => void
  onRestore: (id: string) => void
  showArchived: boolean
}) {
  const label = translate(locale, showArchived ? 'ai.workspace.restore' : 'ai.workspace.archive')

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:opacity-0"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => showArchived ? onRestore(conversationId) : onArchive(conversationId)}
    >
      {showArchived ? <ArrowSquareIn size={16} /> : <Archive size={16} />}
    </Button>
  )
}

function ConversationRow({
  active,
  conversation,
  editing,
  locale,
  onCanArchive,
  onArchive,
  onRename,
  onRestore,
  onSelect,
  onStartEditing,
  showArchived,
  status,
  stopEditing,
}: {
  active: boolean
  conversation: AiConversation
  editing: boolean
  locale: AppLocale
  onCanArchive: (conversation: AiConversation) => boolean
  onArchive: (id: string) => void
  onRename: (id: string, title: string) => void
  onRestore: (id: string) => void
  onSelect: (id: string) => void
  onStartEditing: (id: string) => void
  showArchived: boolean
  status: AgentStatus
  stopEditing: () => void
}) {
  return (
    <div className="group relative flex min-w-0 items-center">
      {editing ? (
        <ConversationTitleEditor
          conversation={conversation}
          locale={locale}
          onCancel={stopEditing}
          onRename={(title) => onRename(conversation.id, title)}
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'min-w-0 flex-1 justify-start gap-2 rounded-md px-2 pr-8 text-left text-[12px]',
            active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
          aria-pressed={active}
          onClick={() => onSelect(conversation.id)}
          onDoubleClick={() => onStartEditing(conversation.id)}
        >
          <span className="truncate">{conversation.title}</span>
          <span className="ml-auto flex shrink-0 items-center">
            <SidebarStatusIndicator status={status} />
          </span>
        </Button>
      )}
      <ConversationArchiveButton
        disabled={!onCanArchive(conversation)}
        conversationId={conversation.id}
        locale={locale}
        onArchive={onArchive}
        onRestore={onRestore}
        showArchived={showArchived}
      />
    </div>
  )
}

function ConversationList({
  activeId,
  conversations,
  editingId,
  locale,
  onCanArchive,
  onArchive,
  onRename,
  onRestore,
  onSelect,
  setEditingId,
  showArchived,
  statuses,
}: Pick<ConversationSidebarProps,
  'activeId' | 'conversations' | 'locale' | 'onCanArchive' | 'onArchive' | 'onRename' | 'onRestore' | 'onSelect' | 'showArchived' | 'statuses'
> & {
  editingId: string | null
  setEditingId: (id: string | null) => void
}) {
  const visibleConversations = conversations.filter((conversation) => conversation.archived === showArchived)
  const emptyLabel = showArchived
    ? translate(locale, 'ai.workspace.noArchivedChats')
    : translate(locale, 'ai.workspace.noActiveChats')

  if (visibleConversations.length === 0) {
    return <div className="px-2 py-4 text-[12px] text-muted-foreground">{emptyLabel}</div>
  }

  return visibleConversations.map((conversation) => (
    <ConversationRow
      key={conversation.id}
      active={conversation.id === activeId}
      conversation={conversation}
      editing={editingId === conversation.id}
      locale={locale}
      onCanArchive={onCanArchive}
      onArchive={onArchive}
      onRename={onRename}
      onRestore={onRestore}
      onSelect={onSelect}
      onStartEditing={setEditingId}
      showArchived={showArchived}
      status={statuses[conversation.id] ?? 'idle'}
      stopEditing={() => setEditingId(null)}
    />
  ))
}

function ArchivedConversationsToggle({
  locale,
  setShowArchived,
  showArchived,
}: Pick<ConversationSidebarProps, 'locale' | 'setShowArchived' | 'showArchived'>) {
  return (
    <div className="border-t border-border p-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start text-[12px] text-muted-foreground"
        onClick={() => setShowArchived(!showArchived)}
      >
        <Archive size={16} />
        {translate(locale, showArchived ? 'ai.workspace.hideArchived' : 'ai.workspace.showArchived')}
      </Button>
    </div>
  )
}

function ExpandedConversationSidebar({
  activeId,
  conversations,
  locale,
  onCanArchive,
  onArchive,
  onRename,
  onRestore,
  onSelect,
  setShowArchived,
  showArchived,
  statuses,
}: Omit<ConversationSidebarProps, 'collapsed' | 'onNewChat' | 'onToggleCollapsed' | 'sidebarWidth'>) {
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <>
      <div className="flex-1 overflow-y-auto p-2">
        <ConversationList
          activeId={activeId}
          conversations={conversations}
          editingId={editingId}
          locale={locale}
          onCanArchive={onCanArchive}
          onArchive={onArchive}
          onRename={onRename}
          onRestore={onRestore}
          onSelect={onSelect}
          setEditingId={setEditingId}
          showArchived={showArchived}
          statuses={statuses}
        />
      </div>
      <ArchivedConversationsToggle
        locale={locale}
        setShowArchived={setShowArchived}
        showArchived={showArchived}
      />
    </>
  )
}

export function ConversationSidebar({
  activeId,
  collapsed,
  conversations,
  locale,
  onCanArchive,
  onArchive,
  onNewChat,
  onRename,
  onRestore,
  onSelect,
  onToggleCollapsed,
  setShowArchived,
  showArchived,
  sidebarWidth,
  statuses,
}: ConversationSidebarProps) {
  return (
    <div
      className="flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width]"
      style={{ width: collapsed ? 48 : sidebarWidth }}
    >
      <SidebarHeader
        collapsed={collapsed}
        locale={locale}
        onNewChat={onNewChat}
        onToggleCollapsed={onToggleCollapsed}
      />
      {collapsed ? (
        <CollapsedConversationSidebar locale={locale} onNewChat={onNewChat} />
      ) : (
        <ExpandedConversationSidebar
          activeId={activeId}
          conversations={conversations}
          locale={locale}
          onCanArchive={onCanArchive}
          onArchive={onArchive}
          onRename={onRename}
          onRestore={onRestore}
          onSelect={onSelect}
          setShowArchived={setShowArchived}
          showArchived={showArchived}
          statuses={statuses}
        />
      )}
    </div>
  )
}
