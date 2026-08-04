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

export function AppAiWorkspaceSurface(options: AppAiWorkspaceSurfaceProps) {
  return <AiWorkspace {...options} />
}
