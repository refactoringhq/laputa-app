import type { AiAgentId } from './aiAgents'
import type { AiAgentPermissionMode } from './aiAgentPermissionMode'
import { trackEvent } from './telemetry'
import type { AllNotesFileVisibility } from '../utils/allNotesFileVisibility'
import type { DateDisplayFormat } from '../utils/dateDisplay'
import type { FilePreviewKind } from '../utils/filePreview'
import type { GitProviderId, NoteWidthMode } from '../types'
import type { CommitMessageDraftSource } from '../utils/commitMessageDraft'
import type { ThemeMode } from './themeMode'

type TrackedPreviewKind = FilePreviewKind | 'unsupported'
type FilePreviewAction = 'copy_deep_link' | 'copy_path' | 'open_external' | 'reveal'
type AgentBlockedReason = 'agent_unavailable' | 'missing_vault'
type AiWorkspaceMode = 'docked' | 'side' | 'window'
type AiWorkspaceTitleSource = 'generated' | 'manual'
type NotePdfExportFailureReason = 'export_unavailable' | 'export_error'
type NotePdfExportSource = 'breadcrumb' | 'app_command' | 'note_list_context_menu'
type AnalyticsBoolean = boolean
type AiAgentResponseText = string
type AiAgentToolCount = number
type AiAgentResponseTextFlag = 'had_text' | 'had_partial_response'
type SheetFormulaFunctionName = string

const ALL_NOTES_VISIBILITY_CATEGORIES: ReadonlyArray<keyof AllNotesFileVisibility> = [
  'pdfs',
  'images',
  'unsupported',
]

function trackedPreviewKind(previewKind: FilePreviewKind | null): TrackedPreviewKind {
  return previewKind ?? 'unsupported'
}

function numericFlag(value: AnalyticsBoolean): number {
  return value ? 1 : 0
}

function aiAgentResponsePayload(
  agent: AiAgentId,
  response: AiAgentResponseText,
  toolCount: AiAgentToolCount,
  textFlag: AiAgentResponseTextFlag,
) {
  return {
    agent,
    [textFlag]: numericFlag(response.trim().length > 0),
    tool_count: toolCount,
  }
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

export function trackNotePdfExportStarted(source: NotePdfExportSource): void {
  trackEvent('note_pdf_export_started', { source })
}

export function trackNotePdfExportFailed(
  source: NotePdfExportSource,
  reason: NotePdfExportFailureReason,
): void {
  trackEvent('note_pdf_export_failed', { reason, source })
}

export function trackAllNotesVisibilityChanged(
  previous: AllNotesFileVisibility,
  next: AllNotesFileVisibility,
): void {
  for (const category of ALL_NOTES_VISIBILITY_CATEGORIES) {
    const previousValue = Reflect.get(previous, category) as boolean
    const nextValue = Reflect.get(next, category) as boolean
    if (previousValue === nextValue) continue
    trackEvent('all_notes_visibility_changed', {
      category,
      enabled: numericFlag(nextValue),
    })
  }
}

export function trackAiFeaturesEnabledChanged(enabled: AnalyticsBoolean): void {
  trackEvent('ai_features_visibility_changed', {
    enabled: numericFlag(enabled),
  })
}

export function trackGitFeaturesEnabledChanged(enabled: AnalyticsBoolean): void {
  trackEvent('git_features_visibility_changed', {
    enabled: numericFlag(enabled),
  })
}

export function trackGitProviderChanged(provider: GitProviderId): void {
  trackEvent('git_provider_changed', { provider })
}

export function trackGitWslDistroChanged(hasDistro: AnalyticsBoolean): void {
  trackEvent('git_wsl_distro_changed', {
    has_distro: numericFlag(hasDistro),
  })
}

export function trackGitProviderTested(provider: GitProviderId, available: AnalyticsBoolean): void {
  trackEvent('git_provider_tested', {
    available: numericFlag(available),
    provider,
  })
}

export function trackCommitMessageGenerated(params: {
  aiAttempted: AnalyticsBoolean
  fileCount: number
  source: CommitMessageDraftSource
}): void {
  trackEvent('commit_message_generated', {
    ai_attempted: numericFlag(params.aiAttempted),
    file_count: params.fileCount,
    source: params.source,
  })
}

export function trackDefaultNoteWidthChanged(mode: NoteWidthMode): void {
  trackEvent('note_width_default_changed', { mode })
}

export function trackDateDisplayFormatChanged(format: DateDisplayFormat): void {
  trackEvent('date_display_format_changed', { format })
}

export function trackSidebarTypePluralizationChanged(enabled: AnalyticsBoolean): void {
  trackEvent('sidebar_type_pluralization_changed', {
    enabled: numericFlag(enabled),
  })
}

export function trackThemeModeChanged(mode: ThemeMode): void {
  trackEvent('theme_mode_changed', { mode })
}

export function trackInlineImageLightboxOpened(): void {
  trackEvent('inline_image_lightbox_opened')
}

export function trackDatePropertyDirectEntrySaved(): void {
  trackEvent('date_property_direct_entry_saved', { source: 'properties_panel' })
}

export function trackSheetEditorOpened(params: {
  columnCount: number
  hasMetadata: boolean
  rowCount: number
}): void {
  trackEvent('sheet_editor_opened', {
    column_count: params.columnCount,
    has_metadata: numericFlag(params.hasMetadata),
    row_count: params.rowCount,
  })
}

export function trackSheetFormulaAutocompleteUsed(functionName: SheetFormulaFunctionName): void {
  trackEvent('sheet_formula_autocomplete_used', { function_name: functionName })
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
  response: AiAgentResponseText,
  toolCount: AiAgentToolCount,
  skipped: AnalyticsBoolean,
): void {
  if (skipped) return
  trackEvent('ai_agent_response_completed', aiAgentResponsePayload(agent, response, toolCount, 'had_text'))
}

export function trackAiAgentResponseFailed(
  agent: AiAgentId,
  response: AiAgentResponseText,
  toolCount: AiAgentToolCount,
): void {
  trackEvent('ai_agent_response_failed', {
    ...aiAgentResponsePayload(agent, response, toolCount, 'had_partial_response'),
    error_kind: 'stream_error',
  })
}

export function trackAiAgentResponseStopped(
  agent: AiAgentId,
  response: AiAgentResponseText,
  toolCount: AiAgentToolCount,
): void {
  trackEvent('ai_agent_response_stopped', aiAgentResponsePayload(agent, response, toolCount, 'had_partial_response'))
}

export function trackAiAgentPermissionModeChanged(agent: AiAgentId, permissionMode: AiAgentPermissionMode): void {
  trackEvent('ai_agent_permission_mode_changed', {
    agent,
    permission_mode: permissionMode,
  })
}

export function trackAiWorkspaceSidebarToggled(collapsed: AnalyticsBoolean, mode: AiWorkspaceMode): void {
  trackEvent('ai_workspace_sidebar_toggled', {
    collapsed: numericFlag(collapsed),
    mode,
  })
}

export function trackAiWorkspaceChatTitled(source: AiWorkspaceTitleSource): void {
  trackEvent('ai_workspace_chat_titled', { source })
}
