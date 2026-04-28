import { useCallback, useMemo, useState } from 'react'
import type { AiAgentId, AiAgentReadiness } from '../lib/aiAgents'
import { useCliAiAgent, type AgentFileCallbacks } from '../hooks/useCliAiAgent'
import type { VaultEntry } from '../types'
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
  handleSend: (text: string, references: NoteReference[]) => void
  handleNavigateWikilink: (target: string) => void
  handleNewChat: () => void
}

function resolveAgentReady(
  readiness: AiAgentReadiness | undefined,
  ready: boolean,
): boolean {
  return (readiness ?? (ready ? 'ready' : 'missing')) === 'ready'
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

  const fileCallbacks = useMemo<AgentFileCallbacks>(() => ({
    onFileCreated,
    onFileModified,
    onVaultChanged,
  }), [onFileCreated, onFileModified, onVaultChanged])

  const agent = useCliAiAgent(vaultPath, contextPrompt, fileCallbacks, {
    agent: defaultAiAgent,
    agentReady: resolveAgentReady(defaultAiAgentReadiness, defaultAiAgentReady),
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
    handleSend,
    handleNavigateWikilink,
    handleNewChat,
  }
}
