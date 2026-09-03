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
import { useAiPanelController, type AiPanelController } from './useAiPanelController'
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
  onUpdateFrontmatter?: (
    path: string,
    key: string,
    value: FrontmatterValue,
    options?: FrontmatterOpOptions,
  ) => Promise<void>
  onDeleteProperty?: (path: string, key: string, options?: FrontmatterOpOptions) => Promise<void>
  onAddProperty?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onCreateMissingType?: (path: string, missingType: string, nextTypeName: string) => Promise<boolean | undefined>
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

function resolveInspectorEntry(entry: VaultEntry | null, entries: VaultEntry[]): VaultEntry | null {
  if (!entry) return null
  return entries.find((candidate) => candidate.path === entry.path) ?? entry
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
  | 'onOpenNote'
  | 'onToggleAIChat'
  | 'onUnsupportedAiPaste'
> & {
  controller: AiPanelController
}

function AiPanelSection(options: AiPanelSectionProps) {
  const { controller, defaultAiAgent = DEFAULT_AI_AGENT, defaultAiAgentReadiness, defaultAiAgentReady = true, defaultAiTarget, entries, inspectorEntry, inspectorWidth, locale, onOpenNote, onToggleAIChat, onUnsupportedAiPaste } = options
  return (
    <div className="shrink-0 flex flex-col min-h-0" style={{ width: inspectorWidth, minWidth: 240, height: '100%' }}>
      <AiPanelView
        controller={controller}
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

function usePersistentAiPanelController(
  options: Pick<
  EditorRightPanelProps,
  | 'showAIChat'
  | 'defaultAiAgent'
  | 'defaultAiTarget'
  | 'defaultAiAgentReadiness'
  | 'defaultAiAgentReady'
  | 'inspectorEntry'
  | 'inspectorContent'
  | 'entries'
  | 'vaultPath'
  | 'vaultPaths'
  | 'noteList'
  | 'noteListFilter'
  | 'locale'
  | 'onOpenNote'
  | 'onFileCreated'
  | 'onFileModified'
  | 'onVaultChanged'
  >,
): AiPanelController {
  const { showAIChat, defaultAiAgent = DEFAULT_AI_AGENT, defaultAiTarget, defaultAiAgentReadiness, defaultAiAgentReady = true, inspectorEntry, inspectorContent, entries, vaultPath, vaultPaths, noteList, noteListFilter, locale, onOpenNote, onFileCreated, onFileModified, onVaultChanged } = options
  return useAiPanelController({
    vaultPath,
    vaultPaths,
    defaultAiAgent,
    defaultAiTarget,
    defaultAiAgentReady,
    defaultAiAgentReadiness,
    activeEntry: showAIChat ? inspectorEntry : null,
    activeNoteContent: showAIChat ? inspectorContent : null,
    entries: showAIChat ? entries : undefined,
    noteList: showAIChat ? noteList : undefined,
    noteListFilter: showAIChat ? noteListFilter : undefined,
    locale,
    onOpenNote,
    onFileCreated,
    onFileModified,
    onVaultChanged,
  })
}

export function EditorRightPanel(options: EditorRightPanelProps) {
  const { showAIChat, showTableOfContents, inspectorCollapsed, inspectorWidth, defaultAiAgent = DEFAULT_AI_AGENT, defaultAiTarget, defaultAiAgentReadiness, defaultAiAgentReady = true, onUnsupportedAiPaste, inspectorEntry, inspectorContent, entries, vaultPath, vaultPaths, noteList, noteListFilter, onToggleAIChat, onOpenNote, onFileCreated, onFileModified, onVaultChanged, locale } = options
  const aiPanelController = usePersistentAiPanelController({
    showAIChat,
    defaultAiAgent,
    defaultAiTarget,
    defaultAiAgentReadiness,
    defaultAiAgentReady,
    inspectorEntry,
    inspectorContent,
    entries,
    vaultPath,
    vaultPaths,
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

  if (!inspectorCollapsed) {
    return renderExpandedInspector(options)
  }

  if (showTableOfContents) {
    return renderTableOfContents(options)
  }

  if (showAIChat) {
    return (
      <AiPanelSection
      controller={aiPanelController}
      defaultAiAgent={defaultAiAgent}
      defaultAiAgentReadiness={defaultAiAgentReadiness}
      defaultAiAgentReady={defaultAiAgentReady}
      defaultAiTarget={defaultAiTarget}
      entries={entries}
      inspectorEntry={inspectorEntry}
      inspectorWidth={inspectorWidth}
      locale={locale}
      onOpenNote={onOpenNote}
      onToggleAIChat={onToggleAIChat}
      onUnsupportedAiPaste={onUnsupportedAiPaste}
    />
    )
  }

  return null
}

function renderExpandedInspector(options: EditorRightPanelProps) {
  const { inspectorCollapsed, inspectorWidth, inspectorEntry, inspectorContent, entries, gitHistory, vaultPath, onToggleInspector, onNavigateWikilink, onViewCommitDiff, onUpdateFrontmatter, onDeleteProperty, onAddProperty, onCreateMissingType, onCreateAndOpenNote, onChangeWorkspace, onInitializeProperties, onToggleRawEditor, workspaces, locale } = options
  const currentInspectorEntry = resolveInspectorEntry(inspectorEntry, entries)
  return (
    <div className="shrink-0 flex flex-col min-h-0" style={{ width: inspectorWidth, height: '100%' }}>
      <Inspector collapsed={inspectorCollapsed} onToggle={onToggleInspector} entry={currentInspectorEntry} content={inspectorContent} entries={entries} gitHistory={gitHistory} vaultPath={vaultPath} onNavigate={onNavigateWikilink} onViewCommitDiff={onViewCommitDiff} onUpdateFrontmatter={onUpdateFrontmatter} onDeleteProperty={onDeleteProperty} onAddProperty={onAddProperty} onCreateMissingType={onCreateMissingType} onCreateAndOpenNote={onCreateAndOpenNote} onChangeWorkspace={onChangeWorkspace} onInitializeProperties={onInitializeProperties} onToggleRawEditor={onToggleRawEditor} workspaces={workspaces} locale={locale} />
    </div>
  )
}

function renderTableOfContents(options: EditorRightPanelProps) {
  const { editor, inspectorContent, inspectorEntry, inspectorWidth, entries, locale, onToggleTableOfContents } = options
  const currentInspectorEntry = resolveInspectorEntry(inspectorEntry, entries)
  return (
    <div className="shrink-0 flex flex-col min-h-0" style={{ width: inspectorWidth, minWidth: 240, height: '100%' }}>
      <TableOfContentsPanel editor={editor} entry={currentInspectorEntry} locale={locale} onClose={() => onToggleTableOfContents?.()} sourceContent={inspectorContent} />
    </div>
  )
}
