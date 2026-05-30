import { Archive, ArrowSquareIn, ArrowSquareOut, GearSix, WarningCircle, X } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { useDragRegion } from '../hooks/useDragRegion'
import { getVaultAiGuidanceSummary, vaultAiGuidanceNeedsRestore, type VaultAiGuidanceStatus } from '../lib/vaultAiGuidance'
import { translate, type AppLocale } from '../lib/i18n'
import type { AiConversation } from './aiWorkspaceConversations'
import type { AiWorkspaceMode } from './aiWorkspaceSizing'

export function GuidanceWarning({
  locale,
  onRestore,
  status,
}: {
  locale: AppLocale
  onRestore?: () => void
  status?: VaultAiGuidanceStatus
}) {
  if (!status || !vaultAiGuidanceNeedsRestore(status)) return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-y border-border bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
      <WarningCircle size={15} className="shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1">
        {translate(locale, 'ai.workspace.guidanceWarning', { summary: getVaultAiGuidanceSummary(status) })}
      </span>
      {status.canRestore && onRestore && (
        <Button type="button" variant="outline" size="xs" onClick={onRestore}>
          {translate(locale, 'ai.workspace.restoreGuidance')}
        </Button>
      )}
    </div>
  )
}

export function WorkspaceHeader({
  conversation,
  archiveDisabled,
  locale,
  mode,
  onArchive,
  onClose,
  onDock,
  onOpenAiSettings,
  onPopOut,
}: {
  conversation: AiConversation
  archiveDisabled: boolean
  locale: AppLocale
  mode: AiWorkspaceMode
  onArchive: () => void
  onClose: () => void
  onDock?: () => void
  onOpenAiSettings?: () => void
  onPopOut?: (context?: { activeConversationId?: string }) => void
}) {
  const { dragRegionRef } = useDragRegion<HTMLDivElement>()

  return (
    <div
      ref={dragRegionRef}
      className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3"
      data-testid="ai-workspace-chat-header"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="min-w-0 max-w-[260px]">
          <div className="truncate text-[13px] font-semibold text-foreground">{conversation.title}</div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onOpenAiSettings && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.settings')} title={translate(locale, 'ai.workspace.settings')} onClick={onOpenAiSettings}>
            <GearSix size={16} />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.archive')} title={translate(locale, 'ai.workspace.archive')} disabled={archiveDisabled} onClick={onArchive}>
          <Archive size={16} />
        </Button>
        {mode === 'docked' ? (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.popOut')} title={translate(locale, 'ai.workspace.popOut')} onClick={() => onPopOut?.({ activeConversationId: conversation.id })}>
            <ArrowSquareOut size={16} />
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.dock')} title={translate(locale, 'ai.workspace.dock')} onClick={onDock}>
            <ArrowSquareIn size={16} />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-xs" aria-label={translate(locale, 'ai.workspace.close')} title={translate(locale, 'ai.workspace.close')} onClick={onClose}>
          <X size={16} />
        </Button>
      </div>
    </div>
  )
}
