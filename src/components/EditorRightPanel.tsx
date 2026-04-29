import { useEffect } from 'react'
import { DEFAULT_AI_AGENT, type AiAgentId, type AiAgentReadiness } from '../lib/aiAgents'
import type { AppLocale } from '../lib/i18n'
import type { VaultEntry, GitCommit } from '../types'
import type { NoteListItem } from '../utils/ai-context'
import { Inspector, type FrontmatterValue } from './Inspector'
import { AiPanelView } from './AiPanel'
import { useAiPanelController } from './useAiPanelController'
import { NEW_AI_CHAT_EVENT } from '../utils/aiPromptBridge'

interface EditorRightPanelProps {
  showAIChat?: boolean
  inspectorCollapsed: boolean
  inspectorWidth: number
  defaultAiAgent?: AiAgentId
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  onUnsupportedAiPaste?: (message: string) => void
  inspectorEntry: VaultEntry | null
  inspectorContent: string | null
  entries: VaultEntry[]
  gitHistory: GitCommit[]
  vaultPath: string
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  onToggleInspector: () => void
  onToggleAIChat?: () => void
  onNavigateWikilink: (target: string) => void
  onViewCommitDiff: (commitHash: string) => Promise<void>
  onUpdateFrontmatter?: (path: string, key: string, value: FrontmatterValue) => Promise<void>
  onDeleteProperty?: (path: string, key: string) => Promise<void>
  onAddProperty?: (path: string, key: string, value: FrontmatterValue) => Promise<void>
  onCreateMissingType?: (path: string, missingType: string, nextTypeName: string) => Promise<boolean | void>
  onCreateAndOpenNote?: (title: string) => Promise<boolean>
  onInitializeProperties?: (path: string) => void
  onToggleRawEditor?: () => void
  onOpenNote?: (path: string) => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onVaultChanged?: () => void
  locale?: AppLocale
}

export function EditorRightPanel({
  showAIChat, inspectorCollapsed, inspectorWidth,
  defaultAiAgent = DEFAULT_AI_AGENT, defaultAiAgentReadiness, defaultAiAgentReady = true,
  onUnsupportedAiPaste,
  inspectorEntry, inspectorContent, entries, gitHistory, vaultPath,
  noteList, noteListFilter,
  onToggleInspector, onToggleAIChat, onNavigateWikilink, onViewCommitDiff,
  onUpdateFrontmatter, onDeleteProperty, onAddProperty, onCreateMissingType, onCreateAndOpenNote, onInitializeProperties, onToggleRawEditor, onOpenNote,
  onFileCreated, onFileModified, onVaultChanged,
  locale,
}: EditorRightPanelProps) {
  const aiPanelController = useAiPanelController({
    vaultPath,
    defaultAiAgent,
    defaultAiAgentReady,
    defaultAiAgentReadiness,
    activeEntry: inspectorEntry,
    activeNoteContent: inspectorContent,
    entries,
    noteList,
    noteListFilter,
    locale,
    onOpenNote,
    onFileCreated,
    onFileModified,
    onVaultChanged,
  })
  const { handleNewChat } = aiPanelController

  useEffect(() => {
    const handleRequestedNewChat = () => {
      handleNewChat()
    }

    window.addEventListener(NEW_AI_CHAT_EVENT, handleRequestedNewChat)
    return () => window.removeEventListener(NEW_AI_CHAT_EVENT, handleRequestedNewChat)
  }, [handleNewChat])

  if (showAIChat) {
    return (
      <div
        className="shrink-0 flex flex-col min-h-0"
        style={{ width: inspectorWidth, minWidth: 240, height: '100%' }}
      >
        <AiPanelView
          controller={aiPanelController}
          onClose={() => onToggleAIChat?.()}
          onOpenNote={onOpenNote}
          onUnsupportedAiPaste={onUnsupportedAiPaste}
          defaultAiAgent={defaultAiAgent}
          defaultAiAgentReadiness={defaultAiAgentReadiness}
          defaultAiAgentReady={defaultAiAgentReady}
          locale={locale}
          activeEntry={inspectorEntry}
          entries={entries}
        />
      </div>
    )
  }

  if (inspectorCollapsed) return null

  return (
    <div
      className="shrink-0 flex flex-col min-h-0"
      style={{ width: inspectorWidth, height: '100%' }}
    >
      <Inspector
        collapsed={inspectorCollapsed}
        onToggle={onToggleInspector}
        entry={inspectorEntry}
        content={inspectorContent}
        entries={entries}
        gitHistory={gitHistory}
        vaultPath={vaultPath}
        onNavigate={onNavigateWikilink}
        onViewCommitDiff={onViewCommitDiff}
        onUpdateFrontmatter={onUpdateFrontmatter}
        onDeleteProperty={onDeleteProperty}
        onAddProperty={onAddProperty}
        onCreateMissingType={onCreateMissingType}
        onCreateAndOpenNote={onCreateAndOpenNote}
        onInitializeProperties={onInitializeProperties}
        onToggleRawEditor={onToggleRawEditor}
        locale={locale}
      />
    </div>
  )
}
