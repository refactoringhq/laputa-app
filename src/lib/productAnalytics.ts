import type { AiAgentId } from './aiAgents'
import type { AiAgentPermissionMode } from './aiAgentPermissionMode'
import { trackEvent } from './telemetry'
import type { AllNotesFileVisibility } from '../utils/allNotesFileVisibility'
import type { FilePreviewKind } from '../utils/filePreview'

type TrackedPreviewKind = FilePreviewKind | 'unsupported'
type FilePreviewAction = 'copy_path' | 'open_external' | 'reveal'
type AgentBlockedReason = 'agent_unavailable' | 'missing_vault'
type NavigationHistoryDirection = 'back' | 'forward'

const ALL_NOTES_VISIBILITY_CATEGORIES: ReadonlyArray<keyof AllNotesFileVisibility> = [
  'pdfs',
  'images',
  'unsupported',
]

function trackedPreviewKind(previewKind: FilePreviewKind | null): TrackedPreviewKind {
  return previewKind ?? 'unsupported'
}

function numericFlag(value: boolean): number {
  return value ? 1 : 0
}

export function trackFilePreviewOpened(previewKind: FilePreviewKind | null): void {
  trackEvent('file_preview_opened', {
    preview_kind: trackedPreviewKind(previewKind),
  })
}

export function trackFilePreviewAction(action: FilePreviewAction, previewKind: FilePreviewKind | null): void {
  trackEvent('file_preview_action', {
    action,
    preview_kind: trackedPreviewKind(previewKind),
  })
}

export function trackFilePreviewFailed(previewKind: FilePreviewKind): void {
  trackEvent('file_preview_failed', { preview_kind: previewKind })
}

export function trackAllNotesVisibilityChanged(
  previous: AllNotesFileVisibility,
  next: AllNotesFileVisibility,
): void {
  for (const category of ALL_NOTES_VISIBILITY_CATEGORIES) {
    if (previous[category] === next[category]) continue
    trackEvent('all_notes_visibility_changed', {
      category,
      enabled: numericFlag(next[category]),
    })
  }
}

export function trackNavigationHistoryButtonClicked(direction: NavigationHistoryDirection): void {
  trackEvent('navigation_history_button_clicked', { direction })
}

export function trackAiAgentMessageBlocked(agent: AiAgentId, reason: AgentBlockedReason): void {
  trackEvent('ai_agent_message_blocked', { agent, reason })
}

export function trackAiAgentMessageSent(params: {
  agent: AiAgentId
  permissionMode: AiAgentPermissionMode
  hasContext: boolean
  referenceCount: number
  historyMessageCount: number
}): void {
  trackEvent('ai_agent_message_sent', {
    agent: params.agent,
    permission_mode: params.permissionMode,
    has_context: numericFlag(params.hasContext),
    reference_count: params.referenceCount,
    history_message_count: params.historyMessageCount,
  })
}

export function trackAiAgentResponseCompleted(
  agent: AiAgentId,
  response: string,
  toolCount: number,
  skipped: boolean,
): void {
  if (skipped) return
  trackEvent('ai_agent_response_completed', {
    agent,
    had_text: numericFlag(response.trim().length > 0),
    tool_count: toolCount,
  })
}

export function trackAiAgentResponseFailed(agent: AiAgentId, response: string, toolCount: number): void {
  trackEvent('ai_agent_response_failed', {
    agent,
    error_kind: 'stream_error',
    had_partial_response: numericFlag(response.trim().length > 0),
    tool_count: toolCount,
  })
}

export function trackAiAgentPermissionModeChanged(agent: AiAgentId, permissionMode: AiAgentPermissionMode): void {
  trackEvent('ai_agent_permission_mode_changed', {
    agent,
    permission_mode: permissionMode,
  })
}
