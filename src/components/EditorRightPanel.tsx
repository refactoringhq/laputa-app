import { useEffect } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import { DEFAULT_AI_AGENT, type AiAgentId, type AiAgentReadiness } from '../lib/aiAgents'
import type { AiTarget } from '../lib/aiTargets'
import type { AppLocale } from '../lib/i18n'
import type { VaultEntry, GitCommit, WorkspaceIdentity } from '../types'
import type { NoteListItem } from '../utils/ai-context'
import { Inspector, type FrontmatterValue } from './Inspector'
import type { FrontmatterOpOptions } from '../hooks/frontmatterOps'
import { AiPanelView } from './AiPanel'
import { useAiPanelController } from './useAiPanelController'
import { NEW_AI_CHAT_EVENT } from '../utils/aiPromptBridge'
import { TableOfContentsPanel } from './TableOfContentsPanel'

interface EditorRightPanelProps {
  showAIChat?: boolean
  showTableOfContents?: boolean
  inspectorCollapsed: boolean
  inspectorWidth: number
  editor: ReturnType<typeof useCreateBlockNote>
  defaultAiAgent?: AiAgentId
  defaultAiTarget?: AiTarget
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  onUnsupportedAiPaste?: (message: string) => void
  inspectorEntry: VaultEntry | null
  inspectorContent: string | null
  entries: VaultEntry[]
  gitHistory: GitCommit[]
  vaultPath: string
  vaultPaths?: string[]
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  onToggleInspector: () => void
  onToggleAIChat?: () => void
  onToggleTableOfContents?: () => void
  onNavigateWikilink: (target: string) => void
  onViewCommitDiff: (commitHash: string) => Promise<void>
  onUpdateFrontmatter?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onDeleteProperty?: (path: string, key: string, options?: FrontmatterOpOptions) => Promise<void>
  onAddProperty?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onCreateMissingType?: (path: string, missingType: string, nextTypeName: string) => Promise<boolean | void>
  onCreateAndOpenNote?: (title: string) => Promise<boolean>
  onChangeWorkspace?: (entry: VaultEntry, workspace: WorkspaceIdentity) => Promise<void> | void
  onInitializeProperties?: (path: string) => void
  onToggleRawEditor?: () => void
  onOpenNote?: (path: string) => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onVaultChanged?: () => void
  workspaces?: WorkspaceIdentity[]
  locale?: AppLocale
}

type AiPanelSectionProps = Pick<
  EditorRightPanelProps,
  | 'defaultAiAgent'
  | 'defaultAiAgentReadiness'
  | 'defaultAiAgentReady'
  | 'defaultAiTarget'
  | 'entries'
  | 'inspectorEntry'
  | 'inspectorWidth'
  | 'locale'
  | 'noteList'
  | 'noteListFilter'
  | 'onFileCreated'
  | 'onFileModified'
  | 'onOpenNote'
  | 'onToggleAIChat'
  | 'onUnsupportedAiPaste'
  | 'onVaultChanged'
  | 'vaultPath'
  | 'vaultPaths'
> & {
  activeNoteContent: string | null
}

function AiPanelSection({
  activeNoteContent,
  defaultAiAgent = DEFAULT_AI_AGENT,
  defaultAiAgentReadiness,
  defaultAiAgentReady = true,
  defaultAiTarget,
  entries,
  inspectorEntry,
  inspectorWidth,
  locale,
  noteList,
  noteListFilter,
  onFileCreated,
  onFileModified,
  onOpenNote,
  onToggleAIChat,
  onUnsupportedAiPaste,
  onVaultChanged,
  vaultPath,
  vaultPaths,
}: AiPanelSectionProps) {
  const aiPanelController = useAiPanelController({
    vaultPath,
    vaultPaths,
    defaultAiAgent,
    defaultAiTarget,
    defaultAiAgentReady,
    defaultAiAgentReadiness,
    activeEntry: inspectorEntry,
    activeNoteContent,
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
        defaultAiTarget={defaultAiTarget}
        defaultAiAgentReadiness={defaultAiAgentReadiness}
        defaultAiAgentReady={defaultAiAgentReady}
        locale={locale}
        activeEntry={inspectorEntry}
        entries={entries}
      />
    </div>
  )
}

export function EditorRightPanel({
  showAIChat, showTableOfContents, inspectorCollapsed, inspectorWidth,
  editor,
  defaultAiAgent = DEFAULT_AI_AGENT, defaultAiTarget, defaultAiAgentReadiness, defaultAiAgentReady = true,
  onUnsupportedAiPaste,
  inspectorEntry, inspectorContent, entries, gitHistory, vaultPath,
  vaultPaths,
  noteList, noteListFilter,
  onToggleInspector, onToggleAIChat, onToggleTableOfContents, onNavigateWikilink, onViewCommitDiff,
  onUpdateFrontmatter, onDeleteProperty, onAddProperty, onCreateMissingType, onCreateAndOpenNote, onChangeWorkspace, onInitializeProperties, onToggleRawEditor, onOpenNote,
  onFileCreated, onFileModified, onVaultChanged,
  workspaces,
  locale,
}: EditorRightPanelProps) {
  if (!inspectorCollapsed) {
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
          onChangeWorkspace={onChangeWorkspace}
          onInitializeProperties={onInitializeProperties}
          onToggleRawEditor={onToggleRawEditor}
          workspaces={workspaces}
          locale={locale}
        />
      </div>
    )
  }

  if (showTableOfContents) {
    return (
      <div
        className="shrink-0 flex flex-col min-h-0"
        style={{ width: inspectorWidth, minWidth: 240, height: '100%' }}
      >
        <TableOfContentsPanel
          editor={editor}
          entry={inspectorEntry}
          locale={locale}
          onClose={() => onToggleTableOfContents?.()}
          sourceContent={inspectorContent}
        />
      </div>
    )
  }

  if (showAIChat) {
    return <AiPanelSection
      activeNoteContent={inspectorContent}
      defaultAiAgent={defaultAiAgent}
      defaultAiAgentReadiness={defaultAiAgentReadiness}
      defaultAiAgentReady={defaultAiAgentReady}
      defaultAiTarget={defaultAiTarget}
      entries={entries}
      inspectorEntry={inspectorEntry}
      inspectorWidth={inspectorWidth}
      locale={locale}
      noteList={noteList}
      noteListFilter={noteListFilter}
      onFileCreated={onFileCreated}
      onFileModified={onFileModified}
      onOpenNote={onOpenNote}
      onToggleAIChat={onToggleAIChat}
      onUnsupportedAiPaste={onUnsupportedAiPaste}
      onVaultChanged={onVaultChanged}
      vaultPath={vaultPath}
      vaultPaths={vaultPaths}
    />
  }

  return null
}
