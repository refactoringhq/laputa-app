import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { AiAgentId, AiAgentReadiness } from '../lib/aiAgents'
import type { AppLocale } from '../lib/i18n'
import { trackAiAgentPermissionModeChanged } from '../lib/productAnalytics'
import {
  aiAgentPermissionModeMarker,
  normalizeAiAgentPermissionMode,
  type AiAgentPermissionMode,
} from '../lib/aiAgentPermissionMode'
import { useCliAiAgent, type AgentFileCallbacks } from '../hooks/useCliAiAgent'
import type { VaultEntry } from '../types'
import {
  getVaultConfig,
  subscribeVaultConfig,
  updateVaultConfigField,
} from '../utils/vaultConfigStore'
import {
  type NoteListItem,
  type NoteReference,
} from '../utils/ai-context'
import { useAiPanelContextSnapshot } from './useAiPanelContextSnapshot'

interface UseAiPanelControllerArgs {
  vaultPath: string
  defaultAiAgent: AiAgentId
  defaultAiAgentReady: boolean
  defaultAiAgentReadiness?: AiAgentReadiness
  activeEntry?: VaultEntry | null
  activeNoteContent?: string | null
  entries?: VaultEntry[]
  openTabs?: VaultEntry[]
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  locale?: AppLocale
  onOpenNote?: (path: string) => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onVaultChanged?: () => void
}

export interface AiPanelController {
  agent: ReturnType<typeof useCliAiAgent>
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  linkedEntries: ReturnType<typeof useAiPanelContextSnapshot>['linkedEntries']
  hasContext: boolean
  isActive: boolean
  permissionMode: AiAgentPermissionMode
  handleSend: (text: string, references: NoteReference[]) => void
  handleNavigateWikilink: (target: string) => void
  handlePermissionModeChange: (mode: AiAgentPermissionMode) => void
  handleNewChat: () => void
}

function resolveAgentReady(
  readiness: AiAgentReadiness | undefined,
  ready: boolean,
): boolean {
  return (readiness ?? (ready ? 'ready' : 'missing')) === 'ready'
}

function useVaultAiAgentPermissionMode(): AiAgentPermissionMode {
  const vaultConfig = useSyncExternalStore(subscribeVaultConfig, getVaultConfig)
  return normalizeAiAgentPermissionMode(vaultConfig.ai_agent_permission_mode)
}

function useAgentFileCallbacks({
  onFileCreated,
  onFileModified,
  onVaultChanged,
}: Pick<
  UseAiPanelControllerArgs,
  'onFileCreated' | 'onFileModified' | 'onVaultChanged'
>): AgentFileCallbacks {
  return useMemo<AgentFileCallbacks>(() => ({
    onFileCreated,
    onFileModified,
    onVaultChanged,
  }), [onFileCreated, onFileModified, onVaultChanged])
}

export function useAiPanelController({
  vaultPath,
  defaultAiAgent,
  defaultAiAgentReady,
  defaultAiAgentReadiness,
  activeEntry,
  activeNoteContent,
  entries,
  openTabs,
  noteList,
  noteListFilter,
  locale = 'en',
  onOpenNote,
  onFileCreated,
  onFileModified,
  onVaultChanged,
}: UseAiPanelControllerArgs): AiPanelController {
  const [input, setInput] = useState('')
  const { linkedEntries, contextPrompt } = useAiPanelContextSnapshot({
    activeEntry,
    activeNoteContent,
    entries,
    input,
    openTabs,
    noteList,
    noteListFilter,
  })

  const fileCallbacks = useAgentFileCallbacks({ onFileCreated, onFileModified, onVaultChanged })
  const permissionMode = useVaultAiAgentPermissionMode()

  const agent = useCliAiAgent(vaultPath, contextPrompt, fileCallbacks, {
    agent: defaultAiAgent,
    agentReady: resolveAgentReady(defaultAiAgentReadiness, defaultAiAgentReady),
    permissionMode,
  })
  const hasContext = !!activeEntry
  const isActive = agent.status === 'thinking' || agent.status === 'tool-executing'

  const handleSend = useCallback((text: string, references: NoteReference[]) => {
    if (!text.trim() || isActive) return
    agent.sendMessage(text, references)
    setInput('')
  }, [agent, isActive])

  const handleNavigateWikilink = useCallback((target: string) => {
    onOpenNote?.(target)
  }, [onOpenNote])

  const handlePermissionModeChange = useCallback((mode: AiAgentPermissionMode) => {
    const nextMode = normalizeAiAgentPermissionMode(mode)
    if (isActive || nextMode === permissionMode) return

    updateVaultConfigField('ai_agent_permission_mode', nextMode)
    trackAiAgentPermissionModeChanged(defaultAiAgent, nextMode)
    agent.addLocalMarker(aiAgentPermissionModeMarker(nextMode, locale))
  }, [agent, defaultAiAgent, isActive, locale, permissionMode])

  const handleNewChat = useCallback(() => {
    agent.clearConversation()
    setInput('')
  }, [agent])

  return {
    agent,
    input,
    setInput,
    linkedEntries,
    hasContext,
    isActive,
    permissionMode,
    handleSend,
    handleNavigateWikilink,
    handlePermissionModeChange,
    handleNewChat,
  }
}
