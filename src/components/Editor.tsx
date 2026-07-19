import { useRef, useEffect, useCallback, memo, useState, type ReactNode } from 'react'
import { useEditorTabSwap } from '../hooks/useEditorTabSwap'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/mantine/style.css'
import 'katex/dist/katex.min.css'
import {
  emptyImageUploadResult,
  isUnsupportedImageFormatError,
  uploadImageFile,
  type ImageImportError,
  type UploadImageFileResult,
} from '../hooks/useImageDrop'
import { DEFAULT_AI_AGENT, type AiAgentId, type AiAgentReadiness } from '../lib/aiAgents'
import type { AiTarget } from '../lib/aiTargets'
import { translate, type AppLocale } from '../lib/i18n'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
import type { VaultEntry, GitCommit, NoteWidthMode, NoteStatus, WorkspaceIdentity } from '../types'
import type { NoteListItem } from '../utils/ai-context'
import type { FrontmatterValue } from './Inspector'
import type { FrontmatterOpOptions } from '../hooks/frontmatterOps'
import { ResizeHandle } from './ResizeHandle'
import { useDiffMode, type CommitDiffRequest } from '../hooks/useDiffMode'
import { useEditorFocus } from '../hooks/useEditorFocus'
import { useDragRegion } from '../hooks/useDragRegion'
import { formatShortcutDisplay } from '../hooks/appCommandCatalog'
import { EditorRightPanel } from './EditorRightPanel'
import { EditorContent } from './EditorContent'
import { EditorMemoryProbe } from './EditorMemoryProbe'
import { FilePreview } from './FilePreview'
import { schema } from './editorSchema'
import { useRightPanelExclusion } from './useRightPanelExclusion'
import type { RawEditorFindRequest } from './RawEditorFindBar'
import {
  resolvePendingRawExitContent,
  resolveRawModeContent,
} from './editorRawModeSync'
import { useRegisterEditorContentFlushes } from './editorContentFlushRegistration'
import { useRawModeWithFlush } from './useRawModeWithFlush'
import { createImeCompositionKeyGuardExtension } from './imeCompositionKeyGuardExtension'
import { createMarkdownHighlightShortcutExtension } from './markdownHighlightShortcutExtension'
import { handleRichEditorPaste } from './richEditorPaste'
import { createRichEditorMarkdownInputTransformExtension } from './richEditorInputTransformExtension'
import { createRichEditorTextDirectionExtension } from './richEditorTextDirection'
import { createRichEditorTransformErrorRecoveryExtension } from './richEditorTransformErrorRecoveryExtension'
import { createRichEditorBlockSelectionExtension } from './richEditorBlockSelectionExtension'
import { createTodoBlockShortcutExtension } from './todoBlockShortcutExtension'
import { createRichEditorCodeBlockTabExtension } from './richEditorCodeBlockTabExtension'
import { createRichEditorCodeBlockShortcutExtension } from './richEditorCodeBlockShortcutExtension'
import { useFilenameAutolinkGuard } from './useFilenameAutolinkGuard'
import { useEditorPdfExport } from './useEditorPdfExport'
import type { NotePdfExportSource } from '../utils/notePdfExport'
import type { RichEditorBlockTypeDefinition } from '../utils/richEditorBlockTypes'
import {
  useRichEditorContentReadiness,
  useRichEditorSheetSwapState,
} from './useRichEditorSheetTransition'
import { installRichEditorMarkdownSerializer } from '../utils/richEditorMarkdown'
import { installRichEditorDispatchPerformanceProbe } from './richEditorDispatchPerformance'
import { RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS } from './richEditorBlockNoteOptions'
import { useTurnCurrentBlockIntoCommand } from './useTurnCurrentBlockIntoCommand'
import './Editor.css'
import './EditorTheme.css'

const RICH_EDITOR_BIDI_DOM_ATTRIBUTES = {
  blockContent: { dir: 'auto' },
  inlineContent: { dir: 'auto' },
}

interface Tab {
  entry: VaultEntry
  content: string
}

interface EditorProps {
  tabs: Tab[]
  activeTabPath: string | null
  isVaultLoading?: boolean
  entries: VaultEntry[]
  onNavigateWikilink: (target: string) => void
  onUnsupportedAiPaste?: (message: string) => void
  onLoadDiff?: (path: string) => Promise<string>
  onLoadDiffAtCommit?: (path: string, commitHash: string) => Promise<string>
  pendingCommitDiffRequest?: CommitDiffRequest | null
  onPendingCommitDiffHandled?: (requestId: number) => void
  getNoteStatus?: (path: string) => NoteStatus
  onCreateNote?: () => void
  inspectorCollapsed: boolean
  onToggleInspector: () => void
  inspectorWidth: number
  defaultAiAgent?: AiAgentId
  defaultAiTarget?: AiTarget
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady?: boolean
  onInspectorResize: (delta: number) => void
  inspectorEntry: VaultEntry | null
  inspectorContent: string | null
  gitHistory: GitCommit[]
  onUpdateFrontmatter?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onDeleteProperty?: (path: string, key: string, options?: FrontmatterOpOptions) => Promise<void>
  onAddProperty?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onCreateMissingType?: (path: string, missingType: string, nextTypeName: string) => Promise<boolean | void>
  onCreateAndOpenNote?: (title: string) => Promise<boolean>
  onChangeWorkspace?: (entry: VaultEntry, workspace: WorkspaceIdentity) => Promise<void> | void
  onInitializeProperties?: (path: string) => void
  showAIChat?: boolean
  onToggleAIChat?: () => void
  aiWorkspaceSurface?: ReactNode
  vaultPath?: string
  vaultPaths?: string[]
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  onToggleFavorite?: (path: string) => void
  onToggleOrganized?: (path: string) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onRevealFile?: (path: string) => void
  onCopyFilePath?: (path: string) => void
  onCopyDeepLink?: (entry: VaultEntry) => void
  onCopyGitUrl?: (entry: VaultEntry) => void
  onOpenExternalFile?: (path: string) => void
  onDeleteNote?: (path: string) => void
  onArchiveNote?: (path: string) => void
  onUnarchiveNote?: (path: string) => void
  onContentChange?: (path: string, content: string) => void
  onSave?: () => void
  /** Called when the user explicitly renames the filename from the breadcrumb. */
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  noteWidth?: NoteWidthMode
  onToggleNoteWidth?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  onGoBack?: () => void
  onGoForward?: () => void
  leftPanelsCollapsed?: boolean
  /** Mutable ref that Editor registers its raw-mode toggle into, for command palette access. */
  rawToggleRef?: React.MutableRefObject<() => void>
  /** Mutable ref that Editor registers editor find commands into, for shortcuts and menus. */
  findInNoteRef?: React.MutableRefObject<((options?: { replace?: boolean }) => void) | null>
  /** Mutable ref that Editor registers its diff-mode toggle into, for command palette access. */
  diffToggleRef?: React.MutableRefObject<() => void>
  /** Mutable ref that Editor registers its table-of-contents toggle into, for app shortcuts and menus. */
  tableOfContentsToggleRef?: React.MutableRefObject<() => void>
  /** Mutable ref that Editor registers the PDF export command into, for command palette and native menu access. */
  pdfExportRef?: React.MutableRefObject<((source?: NotePdfExportSource) => void) | null>
  /** Mutable ref that Editor registers focused-block type changes into, for command palette access. */
  turnCurrentBlockIntoRef?: React.MutableRefObject<((target: RichEditorBlockTypeDefinition) => void) | null>
  /** Emits short user-visible messages for editor actions. */
  onToast?: (message: string | null) => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onVaultChanged?: () => void
  workspaces?: WorkspaceIdentity[]
  /** Whether the active note has a merge conflict. */
  isConflicted?: boolean
  /** Resolve conflict by keeping the local version. */
  onKeepMine?: (path: string) => void
  /** Resolve conflict by keeping the remote version. */
  onKeepTheirs?: (path: string) => void
  /** Registers a hook that flushes pending rich-editor changes into app state before external actions. */
  flushPendingEditorContentRef?: React.MutableRefObject<((path: string) => void) | null>
  /** Registers a hook that flushes the raw editor buffer into app state before external actions. */
  flushPendingRawContentRef?: React.MutableRefObject<((path: string) => void) | null>
  locale?: AppLocale
}

type ImageImportErrorHandler = (error: ImageImportError) => void

function useEditorModeExclusion({
  diffMode, rawMode, handleToggleDiff, handleToggleRaw, rawToggleRef, diffToggleRef,
}: {
  diffMode: boolean
  rawMode: boolean
  handleToggleDiff: () => void | Promise<void>
  handleToggleRaw: () => void
  rawToggleRef?: React.MutableRefObject<() => void>
  diffToggleRef?: React.MutableRefObject<() => void>
}) {
  const handleToggleDiffExclusive = useCallback(async () => {
    if (!diffMode && rawMode) handleToggleRaw()
    await handleToggleDiff()
  }, [diffMode, rawMode, handleToggleDiff, handleToggleRaw])

  const handleToggleRawExclusive = useCallback(() => {
    if (!rawMode && diffMode) handleToggleDiff()
    handleToggleRaw()
  }, [rawMode, diffMode, handleToggleDiff, handleToggleRaw])

  useEffect(() => {
    if (rawToggleRef) rawToggleRef.current = handleToggleRawExclusive
  }, [rawToggleRef, handleToggleRawExclusive])

  useEffect(() => {
    if (diffToggleRef) diffToggleRef.current = handleToggleDiffExclusive
  }, [diffToggleRef, handleToggleDiffExclusive])

  return { handleToggleDiffExclusive, handleToggleRawExclusive }
}

function EditorEmptyState({ locale = 'en' }: { locale?: AppLocale }) {
  const breadcrumbBarHeight = 52
  const { onMouseDown } = useDragRegion()
  const quickOpenShortcut = formatShortcutDisplay({ display: '⌘P / ⌘O' })
  const newNoteShortcut = formatShortcutDisplay({ display: '⌘N' })

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden="true"
        data-tauri-drag-region
        data-testid="editor-empty-state-drag-region"
        className="shrink-0"
        onMouseDown={onMouseDown}
        style={{ height: breadcrumbBarHeight }}
      />
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <p className="m-0 text-[15px]">{translate(locale, 'editor.empty.selectNote')}</p>
        <span className="text-xs text-muted-foreground">{translate(locale, 'editor.empty.shortcuts', { quickOpen: quickOpenShortcut, newNote: newNoteShortcut })}</span>
      </div>
    </div>
  )
}

interface EditorSetupParams {
  tabs: Tab[]
  activeTabPath: string | null
  vaultPath?: string
  onContentChange?: (path: string, content: string) => void
  onLoadDiff?: (path: string) => Promise<string>
  onLoadDiffAtCommit?: (path: string, commitHash: string) => Promise<string>
  pendingCommitDiffRequest?: CommitDiffRequest | null
  onPendingCommitDiffHandled?: (requestId: number) => void
  getNoteStatus?: (path: string) => NoteStatus
  rawToggleRef?: React.MutableRefObject<() => void>
  diffToggleRef?: React.MutableRefObject<() => void>
  onImageImportError?: ImageImportErrorHandler
}

function imageImportErrorMessage(error: ImageImportError, locale: AppLocale | undefined): string {
  if (error.kind === 'unsupported-heic') {
    return translate(locale ?? 'en', 'editor.imageImport.unsupportedHeic', { filename: error.fileName })
  }
  return translate(locale ?? 'en', 'editor.imageImport.unsupported', { filename: error.fileName, format: error.format })
}

function handleEditorImageUploadFailure(
  file: File,
  error: unknown,
  onImageImportError: ImageImportErrorHandler | undefined,
): UploadImageFileResult {
  if (!isUnsupportedImageFormatError(error)) throw error

  onImageImportError?.(error)
  return emptyImageUploadResult(file)
}

function useEditorSetup({
  tabs, activeTabPath, vaultPath, onContentChange,
  onLoadDiff, onLoadDiffAtCommit, pendingCommitDiffRequest, onPendingCommitDiffHandled, getNoteStatus,
  rawToggleRef, diffToggleRef, onImageImportError,
}: EditorSetupParams) {
  const vaultPathRef = useRef(vaultPath)
  const activeTabPathRef = useRef(activeTabPath)
  const onImageImportErrorRef = useRef(onImageImportError)
  const flushPendingEditorChangeRef = useRef<(() => boolean) | null>(null)
  const sheetFlushRef = useRef<((path: string) => void) | null>(null)
  useEffect(() => { vaultPathRef.current = vaultPath }, [vaultPath])
  useEffect(() => { activeTabPathRef.current = activeTabPath }, [activeTabPath])
  useEffect(() => { onImageImportErrorRef.current = onImageImportError }, [onImageImportError])

  const editor = useCreateBlockNote({
    ...RICH_EDITOR_BLOCKNOTE_PERFORMANCE_OPTIONS,
    schema,
    domAttributes: RICH_EDITOR_BIDI_DOM_ATTRIBUTES,
    uploadFile: async (file: File) => {
      try {
        return await uploadImageFile(file, vaultPathRef.current)
      } catch (error) {
        return handleEditorImageUploadFailure(file, error, onImageImportErrorRef.current)
      }
    },
    pasteHandler: handleRichEditorPaste,
    tabBehavior: 'prefer-indent',
    _tiptapOptions: { injectNonce: RUNTIME_STYLE_NONCE },
    extensions: [
      createRichEditorTransformErrorRecoveryExtension(),
      createImeCompositionKeyGuardExtension(),
      createRichEditorCodeBlockTabExtension(),
      createRichEditorCodeBlockShortcutExtension(),
      createMarkdownHighlightShortcutExtension(),
      createTodoBlockShortcutExtension(),
      createRichEditorMarkdownInputTransformExtension(),
      createRichEditorTextDirectionExtension(),
      createRichEditorBlockSelectionExtension(),
    ],
  })
  installRichEditorMarkdownSerializer(editor)
  useEffect(() => {
    installRichEditorDispatchPerformanceProbe(editor, () => activeTabPathRef.current)
  }, [editor])
  useFilenameAutolinkGuard(editor)
  const activeTab = tabs.find((t) => t.entry.path === activeTabPath) ?? null
  const {
    rawMode,
    handleToggleRaw,
    rawLatestContentRef,
    pendingRawExitContent,
    setPendingRawExitContent,
    rawModeContentOverride,
  } = useRawModeWithFlush(
    editor,
    activeTabPath,
    activeTab?.content ?? null,
    onContentChange,
    vaultPath,
    flushPendingEditorChangeRef,
  )
  const rawModeContent = resolveRawModeContent({ activeTab, rawModeContentOverride })

  useEffect(() => {
    setPendingRawExitContent((current) => resolvePendingRawExitContent({
      activeTabPath,
      tabs,
      pendingRawExitContent: current,
    }))
  }, [activeTabPath, setPendingRawExitContent, tabs])

  const {
    activeTabIsSheet,
    richEditorActiveTabPath,
    tabsForEditorSwap,
  } = useRichEditorSheetSwapState({
    activeTab,
    activeTabPath,
    tabs,
    pendingRawExitContent,
  })

  const {
    editorContentPath,
    handleEditorChange,
    flushPendingEditorChange,
    editorMountedRef,
  } = useEditorTabSwap({
    tabs: tabsForEditorSwap,
    activeTabPath: richEditorActiveTabPath,
    editor,
    onContentChange,
    rawMode,
    vaultPath,
  })
  const richEditorContentReady = useRichEditorContentReadiness({
    activeTab,
    activeTabIsSheet,
    editorContentPath,
  })
  useEffect(() => {
    flushPendingEditorChangeRef.current = flushPendingEditorChange
    return () => {
      if (flushPendingEditorChangeRef.current === flushPendingEditorChange) {
        flushPendingEditorChangeRef.current = null
      }
    }
  }, [flushPendingEditorChange])
  useEditorFocus(editor, editorMountedRef)

  const { diffMode, diffContent, diffLoading, handleToggleDiff, handleViewCommitDiff } = useDiffMode({
    activeTabPath,
    onLoadDiff,
    onLoadDiffAtCommit,
    pendingCommitDiffRequest,
    onPendingCommitDiffHandled,
  })

  const { handleToggleDiffExclusive, handleToggleRawExclusive } = useEditorModeExclusion({
    diffMode, rawMode, handleToggleDiff, handleToggleRaw, rawToggleRef, diffToggleRef,
  })

  const isLoadingNewTab = activeTabPath !== null && !activeTab
  const activeStatus = activeTab ? getNoteStatus?.(activeTab.entry.path) ?? 'clean' : 'clean'
  const showDiffToggle = !!(activeTab && (diffMode || activeStatus === 'modified'))

  return {
    editor, activeTab, rawLatestContentRef, rawModeContent,
    rawMode, diffMode, diffContent, diffLoading,
    handleToggleDiffExclusive, handleToggleRawExclusive,
    handleEditorChange, flushPendingEditorChange, handleViewCommitDiff,
    isLoadingNewTab, activeStatus, showDiffToggle, sheetFlushRef, richEditorContentReady,
  }
}

function useEditorFindCommand({
  activeTab,
  findInNoteRef,
  handleToggleRawExclusive,
  rawMode,
}: {
  activeTab: Tab | null
  findInNoteRef?: EditorProps['findInNoteRef']
  handleToggleRawExclusive: () => void
  rawMode: boolean
}): RawEditorFindRequest | null {
  const [findRequest, setFindRequest] = useState<RawEditorFindRequest | null>(null)
  const handleFindInNote = useCallback((options: { replace?: boolean } = {}) => {
    if (!activeTab || activeTab.entry.fileKind === 'binary') return
    if (!rawMode) handleToggleRawExclusive()

    setFindRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      path: activeTab.entry.path,
      replace: options.replace === true,
    }))
  }, [activeTab, handleToggleRawExclusive, rawMode])

  useEffect(() => {
    if (!findInNoteRef) return

    findInNoteRef.current = handleFindInNote
    return () => {
      if (findInNoteRef.current === handleFindInNote) {
        findInNoteRef.current = null
      }
    }
  }, [findInNoteRef, handleFindInNote])

  return findRequest
}

function EditorLayout({
  tabs,
  activeTabPath,
  activeTab,
  isLoadingNewTab,
  isVaultLoading,
  entries,
  editor,
  diffMode,
  diffContent,
  diffLoading,
  richEditorContentReady,
  handleToggleDiffExclusive,
  rawMode,
  handleToggleRawExclusive,
  onContentChange,
  onSave,
  activeStatus,
  showDiffToggle,
  showAIChat,
  onToggleAIChat,
  aiWorkspaceSurface,
  showTableOfContents,
  onToggleTableOfContents,
  inspectorCollapsed,
  onToggleInspector,
  onNavigateWikilink,
  handleEditorChange,
  onToggleFavorite,
  onToggleOrganized,
  onEnterNeighborhood,
  onRevealFile,
  onCopyFilePath,
  onCopyDeepLink,
  onCopyGitUrl,
  onExportPdf,
  onOpenExternalFile,
  onDeleteNote,
  onArchiveNote,
  onUnarchiveNote,
  vaultPath,
  vaultPaths,
  rawModeContent,
  findRequest,
  rawLatestContentRef,
  sheetFlushRef,
  onRenameFilename,
  noteWidth,
  onToggleNoteWidth,
  isConflicted,
  onKeepMine,
  onKeepTheirs,
  onInspectorResize,
  inspectorWidth,
  defaultAiAgent,
  defaultAiTarget,
  defaultAiAgentReadiness,
  defaultAiAgentReady,
  inspectorEntry,
  inspectorContent,
  gitHistory,
  noteList,
  noteListFilter,
  handleViewCommitDiff,
  onUpdateFrontmatter,
  onDeleteProperty,
  onAddProperty,
  onCreateMissingType,
  onCreateAndOpenNote,
  onChangeWorkspace,
  onInitializeProperties,
  onFileCreated,
  onFileModified,
  onVaultChanged,
  workspaces,
  onUnsupportedAiPaste,
  onImageImportError,
  locale,
}: {
  tabs: Tab[]
  activeTabPath: string | null
  activeTab: Tab | null
  isLoadingNewTab: boolean
  isVaultLoading?: boolean
  entries: VaultEntry[]
  editor: ReturnType<typeof useCreateBlockNote>
  diffMode: boolean
  diffContent: string | null
  diffLoading: boolean
  richEditorContentReady: boolean
  handleToggleDiffExclusive: () => void | Promise<void>
  rawMode: boolean
  handleToggleRawExclusive: () => void
  onContentChange?: (path: string, content: string) => void
  onSave?: () => void
  activeStatus: NoteStatus
  showDiffToggle: boolean
  showAIChat?: boolean
  onToggleAIChat?: () => void
  aiWorkspaceSurface?: ReactNode
  showTableOfContents?: boolean
  onToggleTableOfContents?: () => void
  inspectorCollapsed: boolean
  onToggleInspector: () => void
  onNavigateWikilink: (target: string) => void
  handleEditorChange: () => void
  onToggleFavorite?: (path: string) => void
  onToggleOrganized?: (path: string) => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onRevealFile?: (path: string) => void
  onCopyFilePath?: (path: string) => void
  onCopyDeepLink?: (entry: VaultEntry) => void
  onCopyGitUrl?: (entry: VaultEntry) => void
  onOpenExternalFile?: (path: string) => void
  onDeleteNote?: (path: string) => void
  onArchiveNote?: (path: string) => void
  onUnarchiveNote?: (path: string) => void
  vaultPath?: string
  vaultPaths?: string[]
  rawModeContent: string | null
  findRequest?: RawEditorFindRequest | null
  rawLatestContentRef: React.MutableRefObject<string | null>
  sheetFlushRef: React.MutableRefObject<((path: string) => void) | null>
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  noteWidth?: NoteWidthMode
  onToggleNoteWidth?: () => void
  isConflicted?: boolean
  onKeepMine?: (path: string) => void
  onKeepTheirs?: (path: string) => void
  onInspectorResize: (delta: number) => void
  inspectorWidth: number
  defaultAiAgent: AiAgentId
  defaultAiTarget?: AiTarget
  defaultAiAgentReadiness?: AiAgentReadiness
  defaultAiAgentReady: boolean
  inspectorEntry: VaultEntry | null
  inspectorContent: string | null
  gitHistory: GitCommit[]
  noteList?: NoteListItem[]
  noteListFilter?: { type: string | null; query: string }
  handleViewCommitDiff: (commitHash: string) => Promise<void>
  onUpdateFrontmatter?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onDeleteProperty?: (path: string, key: string, options?: FrontmatterOpOptions) => Promise<void>
  onAddProperty?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onCreateMissingType?: (path: string, missingType: string, nextTypeName: string) => Promise<boolean | void>
  onCreateAndOpenNote?: (title: string) => Promise<boolean>
  onChangeWorkspace?: (entry: VaultEntry, workspace: WorkspaceIdentity) => Promise<void> | void
  onInitializeProperties?: (path: string) => void
  onFileCreated?: (relativePath: string) => void
  onFileModified?: (relativePath: string) => void
  onVaultChanged?: () => void
  workspaces?: WorkspaceIdentity[]
  onUnsupportedAiPaste?: (message: string) => void
  onImageImportError?: ImageImportErrorHandler
  locale?: AppLocale
  onExportPdf?: (source?: NotePdfExportSource) => void
}) {
  const activeBinaryTab = activeTab?.entry.fileKind === 'binary' ? activeTab : null
  const showEmptyState = tabs.length === 0 && activeTabPath === null && !isVaultLoading

  return (
    <div className="editor flex flex-col min-h-0 overflow-hidden bg-background text-foreground">
      <div className="relative flex flex-1 min-h-0">
        {showEmptyState
          ? <EditorEmptyState locale={locale} />
          : activeBinaryTab
            ? (
                <FilePreview
                  key={activeBinaryTab.entry.path}
                  entry={activeBinaryTab.entry}
                  locale={locale}
                  onCopyFilePath={onCopyFilePath}
                  onCopyDeepLink={onCopyDeepLink}
                  onOpenExternalFile={onOpenExternalFile}
                  onRevealFile={onRevealFile}
                />
              )
            : <EditorContent
              activeTab={activeTab}
              activeTabPath={activeTabPath}
              isLoadingNewTab={isLoadingNewTab}
              isVaultLoading={isVaultLoading}
              entries={entries}
              editor={editor}
              diffMode={diffMode}
              diffContent={diffContent}
              diffLoading={diffLoading}
              richEditorContentReady={richEditorContentReady}
              onToggleDiff={handleToggleDiffExclusive}
              rawMode={rawMode}
              onToggleRaw={handleToggleRawExclusive}
              onRawContentChange={onContentChange}
              onSave={onSave}
              activeStatus={activeStatus}
              showDiffToggle={showDiffToggle}
              showAIChat={showAIChat}
              onToggleAIChat={onToggleAIChat}
              showTableOfContents={showTableOfContents}
              onToggleTableOfContents={onToggleTableOfContents}
              inspectorCollapsed={inspectorCollapsed}
              onToggleInspector={onToggleInspector}
              onNavigateWikilink={onNavigateWikilink}
              onEditorChange={handleEditorChange}
              onToggleFavorite={onToggleFavorite}
              onToggleOrganized={onToggleOrganized}
              onEnterNeighborhood={onEnterNeighborhood}
              onRevealFile={onRevealFile}
              onCopyFilePath={onCopyFilePath}
              onCopyDeepLink={onCopyDeepLink}
              onCopyGitUrl={onCopyGitUrl}
              onExportPdf={() => onExportPdf?.('breadcrumb')}
              onDeleteNote={onDeleteNote}
              onArchiveNote={onArchiveNote}
              onUnarchiveNote={onUnarchiveNote}
              vaultPath={vaultPath}
              rawModeContent={rawModeContent}
              findRequest={findRequest}
              rawLatestContentRef={rawLatestContentRef}
              sheetFlushRef={sheetFlushRef}
              onRenameFilename={onRenameFilename}
              noteWidth={noteWidth}
              onToggleNoteWidth={onToggleNoteWidth}
              isConflicted={isConflicted}
              onKeepMine={onKeepMine}
              onKeepTheirs={onKeepTheirs}
              onImageImportError={onImageImportError}
              locale={locale}
            />
        }
        {(showTableOfContents || !inspectorCollapsed) && <ResizeHandle onResize={onInspectorResize} />}
        <EditorRightPanel
          showAIChat={false}
          showTableOfContents={showTableOfContents}
          inspectorCollapsed={inspectorCollapsed}
          inspectorWidth={inspectorWidth}
          editor={editor}
          defaultAiAgent={defaultAiAgent}
          defaultAiTarget={defaultAiTarget}
          defaultAiAgentReadiness={defaultAiAgentReadiness}
          defaultAiAgentReady={defaultAiAgentReady}
          onUnsupportedAiPaste={onUnsupportedAiPaste}
          inspectorEntry={inspectorEntry}
          inspectorContent={inspectorContent}
          entries={entries}
          gitHistory={gitHistory}
          vaultPath={vaultPath ?? ''}
          vaultPaths={vaultPaths}
          noteList={noteList}
          noteListFilter={noteListFilter}
          onToggleInspector={onToggleInspector}
          onToggleAIChat={onToggleAIChat}
          onToggleTableOfContents={onToggleTableOfContents}
          onNavigateWikilink={onNavigateWikilink}
          onViewCommitDiff={handleViewCommitDiff}
          onUpdateFrontmatter={onUpdateFrontmatter}
          onDeleteProperty={onDeleteProperty}
          onAddProperty={onAddProperty}
          onCreateMissingType={onCreateMissingType}
          onCreateAndOpenNote={onCreateAndOpenNote}
          onChangeWorkspace={onChangeWorkspace}
          onInitializeProperties={onInitializeProperties}
          onToggleRawEditor={handleToggleRawExclusive}
          onOpenNote={onNavigateWikilink}
          onFileCreated={onFileCreated}
          onFileModified={onFileModified}
          onVaultChanged={onVaultChanged}
          workspaces={workspaces}
          locale={locale}
        />
        {showAIChat && aiWorkspaceSurface}
      </div>
      <EditorMemoryProbe entries={entries} vaultPath={vaultPath} locale={locale} />
    </div>
  )
}

type EditorRuntime = ReturnType<typeof useEditorSetup>
type EditorLayoutProps = Parameters<typeof EditorLayout>[0]

function buildEditorLayoutProps(
  props: EditorProps,
  runtime: EditorRuntime,
  findRequest: RawEditorFindRequest | null,
): EditorLayoutProps {
  return {
    ...props,
    ...runtime,
    activeTabPath: props.activeTabPath,
    defaultAiAgent: props.defaultAiAgent ?? DEFAULT_AI_AGENT,
    defaultAiAgentReady: props.defaultAiAgentReady ?? true,
    findRequest,
  }
}

export const Editor = memo(function Editor(props: EditorProps) {
  const { locale, onToast } = props
  const handleImageImportError = useCallback((error: ImageImportError) => {
    onToast?.(imageImportErrorMessage(error, locale))
  }, [locale, onToast])
  const runtime = useEditorSetup({
    tabs: props.tabs,
    activeTabPath: props.activeTabPath,
    vaultPath: props.vaultPath,
    onContentChange: props.onContentChange,
    onLoadDiff: props.onLoadDiff,
    onLoadDiffAtCommit: props.onLoadDiffAtCommit,
    pendingCommitDiffRequest: props.pendingCommitDiffRequest,
    onPendingCommitDiffHandled: props.onPendingCommitDiffHandled,
    getNoteStatus: props.getNoteStatus,
    rawToggleRef: props.rawToggleRef,
    diffToggleRef: props.diffToggleRef,
    onImageImportError: handleImageImportError,
  })
  const findRequest = useEditorFindCommand({
    activeTab: runtime.activeTab,
    findInNoteRef: props.findInNoteRef,
    handleToggleRawExclusive: runtime.handleToggleRawExclusive,
    rawMode: runtime.rawMode,
  })
  useTurnCurrentBlockIntoCommand({
    activeTab: runtime.activeTab,
    diffMode: runtime.diffMode,
    editor: runtime.editor,
    rawMode: runtime.rawMode,
    turnCurrentBlockIntoRef: props.turnCurrentBlockIntoRef,
  })
  const handleExportPdf = useEditorPdfExport({
    activeTab: runtime.activeTab,
    diffMode: runtime.diffMode,
    handleToggleDiffExclusive: runtime.handleToggleDiffExclusive,
    handleToggleRawExclusive: runtime.handleToggleRawExclusive,
    locale: props.locale,
    onToast: props.onToast,
    pdfExportRef: props.pdfExportRef,
    rawMode: runtime.rawMode,
  })
  useRegisterEditorContentFlushes({
    activeTab: runtime.activeTab,
    flushPendingEditorChange: runtime.flushPendingEditorChange,
    flushPendingEditorContentRef: props.flushPendingEditorContentRef,
    sheetFlushRef: runtime.sheetFlushRef,
    rawLatestContentRef: runtime.rawLatestContentRef,
    rawMode: runtime.rawMode,
    onContentChange: props.onContentChange,
    flushPendingRawContentRef: props.flushPendingRawContentRef,
  })
  const rightPanel = useRightPanelExclusion(props)
  const { tableOfContentsToggleRef } = props
  useEffect(() => {
    if (tableOfContentsToggleRef) {
      tableOfContentsToggleRef.current = rightPanel.handleToggleTableOfContents
    }
  }, [tableOfContentsToggleRef, rightPanel.handleToggleTableOfContents])

  return (
    <EditorLayout
      {...buildEditorLayoutProps(props, runtime, findRequest)}
      onImageImportError={handleImageImportError}
      onToggleInspector={rightPanel.handleToggleInspectorPanel}
      showAIChat={props.showAIChat}
      onToggleAIChat={props.onToggleAIChat ? rightPanel.handleToggleAIChatPanel : undefined}
      showTableOfContents={rightPanel.showTableOfContents}
      onToggleTableOfContents={rightPanel.handleToggleTableOfContents}
      onExportPdf={handleExportPdf}
    />
  )
})
