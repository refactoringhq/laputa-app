import type { AiAgentId, AiAgentReadiness, AiAgentsStatus } from '../lib/aiAgents'
import type { AiModelProvider, AiTarget } from '../lib/aiTargets'
import type { AppLocale } from '../lib/i18n'
import type { NoteListItem } from '../utils/ai-context'
import type { VaultAiGuidanceStatus } from '../lib/vaultAiGuidance'
import type { AiWorkspaceConversationSetting, VaultEntry } from '../types'
import { AiWorkspace } from './AiWorkspace'

interface AppAiWorkspaceSurfaceProps {
  activeEntry?: VaultEntry | null
  activeNoteContent?: string | null
  aiAgentsStatus: AiAgentsStatus
  aiModelProviders?: AiModelProvider[]
  conversationSettings?: AiWorkspaceConversationSetting[] | null
  conversationSettingsReady?: boolean
  defaultAiAgent: AiAgentId
  defaultAiAgentReadiness: AiAgentReadiness
  defaultAiAgentReady: boolean
  defaultAiTarget?: AiTarget
  entries: VaultEntry[]
  initialActiveConversationId?: string
  locale: AppLocale
  mode: 'docked' | 'side' | 'window'
  noteList: NoteListItem[]
  noteListFilter: { type: string | null; query: string }
  onActiveConversationChange?: (id: string) => void
  onActiveTargetChange?: (target: AiTarget) => void
  onClose: () => void
  onConversationSettingsChange?: (conversations: AiWorkspaceConversationSetting[]) => void
  onDock?: () => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onOpenAiSettings?: () => void
  onOpenNote?: (path: string) => void
  onPopOut?: (context?: { activeConversationId?: string }) => void
  onRestoreVaultAiGuidance?: () => void
  onUnsupportedAiPaste?: (message: string) => void
  onVaultChanged?: () => void
  open: boolean
  openTabs: VaultEntry[]
  vaultAiGuidanceStatus?: VaultAiGuidanceStatus
  vaultPath: string
  vaultPaths?: string[]
}

export function AppAiWorkspaceSurface({
  activeEntry,
  activeNoteContent,
  aiAgentsStatus,
  aiModelProviders,
  conversationSettings,
  conversationSettingsReady,
  defaultAiAgent,
  defaultAiAgentReadiness,
  defaultAiAgentReady,
  defaultAiTarget,
  entries,
  initialActiveConversationId,
  locale,
  mode,
  noteList,
  noteListFilter,
  onActiveConversationChange,
  onActiveTargetChange,
  onClose,
  onConversationSettingsChange,
  onDock,
  onFileCreated,
  onFileModified,
  onOpenAiSettings,
  onOpenNote,
  onPopOut,
  onRestoreVaultAiGuidance,
  onUnsupportedAiPaste,
  onVaultChanged,
  open,
  openTabs,
  vaultAiGuidanceStatus,
  vaultPath,
  vaultPaths,
}: AppAiWorkspaceSurfaceProps) {
  return (
    <AiWorkspace
      mode={mode}
      open={open}
      aiAgentsStatus={aiAgentsStatus}
      aiModelProviders={aiModelProviders}
      conversationSettings={conversationSettings}
      conversationSettingsReady={conversationSettingsReady}
      defaultAiAgent={defaultAiAgent}
      defaultAiTarget={defaultAiTarget}
      defaultAiAgentReadiness={defaultAiAgentReadiness}
      defaultAiAgentReady={defaultAiAgentReady}
      initialActiveConversationId={initialActiveConversationId}
      activeEntry={activeEntry}
      activeNoteContent={activeNoteContent}
      entries={entries}
      openTabs={openTabs}
      noteList={noteList}
      noteListFilter={noteListFilter}
      onActiveConversationChange={onActiveConversationChange}
      onActiveTargetChange={onActiveTargetChange}
      onClose={onClose}
      onConversationSettingsChange={onConversationSettingsChange}
      onDock={onDock}
      onPopOut={onPopOut}
      onOpenAiSettings={onOpenAiSettings}
      onOpenNote={onOpenNote}
      onRestoreVaultAiGuidance={onRestoreVaultAiGuidance}
      onUnsupportedAiPaste={onUnsupportedAiPaste}
      onFileCreated={onFileCreated}
      onFileModified={onFileModified}
      onVaultChanged={onVaultChanged}
      vaultAiGuidanceStatus={vaultAiGuidanceStatus}
      vaultPath={vaultPath}
      vaultPaths={vaultPaths}
      locale={locale}
    />
  )
}
