import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { translate, type AppLocale } from '../../lib/i18n'
import type { VaultEntry } from '../../types'
import { dispatchEditorFindAvailability } from '../../utils/editorFindEvents'
import { DiffView } from '../DiffView'
import { BreadcrumbBar } from '../BreadcrumbBar'
import { ArchivedNoteBanner } from '../ArchivedNoteBanner'
import { ConflictNoteBanner } from '../ConflictNoteBanner'
import { RawEditorView } from '../RawEditorView'
import { SingleEditorView } from '../SingleEditorView'
import type { useEditorContentModel } from './useEditorContentModel'

type EditorContentModel = ReturnType<typeof useEditorContentModel>

type BreadcrumbActions = Pick<
  EditorContentModel,
  | 'diffMode'
  | 'diffLoading'
  | 'onToggleDiff'
  | 'effectiveRawMode'
  | 'onToggleRaw'
  | 'forceRawMode'
  | 'showAIChat'
  | 'onToggleAIChat'
  | 'inspectorCollapsed'
  | 'onToggleInspector'
  | 'showDiffToggle'
  | 'onToggleFavorite'
  | 'onToggleOrganized'
  | 'onRevealFile'
  | 'onCopyFilePath'
  | 'onDeleteNote'
  | 'onArchiveNote'
  | 'onUnarchiveNote'
  | 'onRenameFilename'
  | 'noteWidth'
  | 'onToggleNoteWidth'
>

const LOADING_BREADCRUMB_ENTRY: VaultEntry = {
  path: '',
  filename: 'loading.md',
  title: '',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: null,
  createdAt: null,
  fileSize: 0,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: true,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: false,
  fileKind: 'markdown',
}

function EditorLoadingSkeleton() {
  return (
    <div data-testid="editor-content-skeleton" className="flex flex-1 flex-col gap-3 py-5 animate-pulse" style={{ minHeight: 0 }}>
      <div className="h-6 w-2/5 rounded bg-muted" />
      <div className="h-4 w-4/5 rounded bg-muted" />
      <div className="h-4 w-3/5 rounded bg-muted" />
      <div className="h-4 w-4/5 rounded bg-muted" />
      <div className="h-4 w-2/5 rounded bg-muted" />
    </div>
  )
}

function EditorLoadingCanvas({ cssVars }: Pick<EditorContentModel, 'cssVars'>) {
  return (
    <div className="editor-scroll-area" style={cssVars as React.CSSProperties}>
      <div className="editor-content-wrapper">
        <EditorLoadingSkeleton />
      </div>
    </div>
  )
}

function DiffModeView({ diffContent, locale = 'en', onToggleDiff }: { diffContent: string | null; locale?: AppLocale; onToggleDiff: () => void }) {
  const label = translate(locale, 'editor.toolbar.rawReturn')

  return (
    <div className="flex-1 overflow-auto">
      <button
        className="flex items-center gap-1.5 px-4 py-2 text-xs text-primary bg-muted border-b border-border cursor-pointer hover:bg-accent transition-colors w-full border-t-0 border-l-0 border-r-0"
        onClick={onToggleDiff}
        title={label}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>&larr;</span>
        {label}
      </button>
      <DiffView diff={diffContent ?? ''} />
    </div>
  )
}

function RawModeEditorSection({
  activeTab,
  entries,
  findRequest,
  rawMode,
  rawModeContent,
  onRawContentChange,
  onSave,
  rawLatestContentRef,
  vaultPath,
  locale,
}: Pick<
  EditorContentModel,
  'activeTab' | 'entries' | 'findRequest' | 'onRawContentChange' | 'onSave' | 'rawLatestContentRef' | 'rawModeContent' | 'vaultPath'
> & {
  rawMode: boolean
  locale?: AppLocale
}) {
  if (!rawMode || !activeTab) return null

  return (
    <EditorFindScope className="editor-scroll-area">
      <RawEditorView
        key={activeTab.entry.path}
        content={rawModeContent ?? activeTab.content}
        path={activeTab.entry.path}
        entries={entries}
        findRequest={findRequest}
        onContentChange={onRawContentChange ?? (() => {})}
        onSave={onSave ?? (() => {})}
        latestContentRef={rawLatestContentRef}
        vaultPath={vaultPath}
        locale={locale}
      />
    </EditorFindScope>
  )
}

function bindPath(cb: ((path: string) => void) | undefined, path: string) {
  return cb ? () => cb(path) : undefined
}

function ActiveTabBreadcrumb({
  activeTab,
  barRef,
  wordCount,
  path,
  actions,
  locale,
  loadingTitle,
}: {
  activeTab: NonNullable<EditorContentModel['activeTab']>
  barRef: React.RefObject<HTMLDivElement | null>
  wordCount: number
  path: string
  actions: BreadcrumbActions
  locale?: AppLocale
  loadingTitle?: boolean
}) {
  return (
    <BreadcrumbBar
      entry={activeTab.entry}
      wordCount={wordCount}
      barRef={barRef}
      loadingTitle={loadingTitle}
      showDiffToggle={actions.showDiffToggle}
      diffMode={actions.diffMode}
      diffLoading={actions.diffLoading}
      onToggleDiff={actions.onToggleDiff}
      rawMode={actions.effectiveRawMode}
      onToggleRaw={actions.onToggleRaw}
      forceRawMode={actions.forceRawMode}
      showAIChat={actions.showAIChat}
      onToggleAIChat={actions.onToggleAIChat}
      inspectorCollapsed={actions.inspectorCollapsed}
      onToggleInspector={actions.onToggleInspector}
      onToggleFavorite={bindPath(actions.onToggleFavorite, path)}
      onToggleOrganized={bindPath(actions.onToggleOrganized, path)}
      onRevealFile={actions.onRevealFile}
      onCopyFilePath={actions.onCopyFilePath}
      onDelete={bindPath(actions.onDeleteNote, path)}
      onArchive={bindPath(actions.onArchiveNote, path)}
      onUnarchive={bindPath(actions.onUnarchiveNote, path)}
      onRenameFilename={actions.onRenameFilename}
      noteWidth={actions.noteWidth}
      onToggleNoteWidth={actions.onToggleNoteWidth}
      locale={locale}
    />
  )
}

function EditorLoadingBreadcrumb({
  actions,
  barRef,
  locale,
}: {
  actions: BreadcrumbActions
  barRef: React.RefObject<HTMLDivElement | null>
  locale?: AppLocale
}) {
  return (
    <BreadcrumbBar
      entry={LOADING_BREADCRUMB_ENTRY}
      wordCount={0}
      barRef={barRef}
      loadingTitle
      showDiffToggle={false}
      diffMode={false}
      diffLoading={false}
      onToggleDiff={actions.onToggleDiff}
      rawMode={false}
      forceRawMode={false}
      showAIChat={actions.showAIChat}
      onToggleAIChat={actions.onToggleAIChat}
      inspectorCollapsed={actions.inspectorCollapsed}
      onToggleInspector={actions.onToggleInspector}
      noteWidth={actions.noteWidth}
      onToggleNoteWidth={actions.onToggleNoteWidth}
      locale={locale}
    />
  )
}

function buildBreadcrumbActions(model: EditorContentModel): BreadcrumbActions {
  return {
    diffMode: model.diffMode,
    diffLoading: model.diffLoading,
    onToggleDiff: model.onToggleDiff,
    effectiveRawMode: model.effectiveRawMode,
    onToggleRaw: model.onToggleRaw,
    forceRawMode: model.forceRawMode,
    showAIChat: model.showAIChat,
    onToggleAIChat: model.onToggleAIChat,
    inspectorCollapsed: model.inspectorCollapsed,
    onToggleInspector: model.onToggleInspector,
    showDiffToggle: model.showDiffToggle,
    onToggleFavorite: model.onToggleFavorite,
    onToggleOrganized: model.onToggleOrganized,
    onRevealFile: model.onRevealFile,
    onCopyFilePath: model.onCopyFilePath,
    onDeleteNote: model.onDeleteNote,
    onArchiveNote: model.onArchiveNote,
    onUnarchiveNote: model.onUnarchiveNote,
    onRenameFilename: model.onRenameFilename,
    noteWidth: model.noteWidth,
    onToggleNoteWidth: model.onToggleNoteWidth,
  }
}

function EditorBreadcrumbArea({
  actions,
  barRef,
  chromePath,
  chromeTab,
  chromeWordCount,
  isVaultLoading,
  locale,
}: {
  actions: BreadcrumbActions
  barRef: React.RefObject<HTMLDivElement | null>
  chromePath: string
  chromeTab: EditorContentModel['activeTab'] | EditorContentModel['loadingTab']
  chromeWordCount: number
  isVaultLoading?: boolean
  locale?: AppLocale
}) {
  if (chromeTab) {
    return (
      <ActiveTabBreadcrumb
        activeTab={chromeTab}
        barRef={barRef}
        wordCount={chromeWordCount}
        path={chromePath}
        locale={locale}
        loadingTitle={isVaultLoading}
        actions={actions}
      />
    )
  }

  if (!isVaultLoading) return null

  return (
    <EditorLoadingBreadcrumb
      actions={actions}
      barRef={barRef}
      locale={locale}
    />
  )
}

function EditorChrome({
  isArchived,
  onUnarchiveNote,
  path,
  isConflicted,
  onKeepMine,
  onKeepTheirs,
  diffMode,
  diffContent,
  onToggleDiff,
  locale,
}: Pick<
  EditorContentModel,
  'isArchived' | 'onUnarchiveNote' | 'path' | 'isConflicted' | 'onKeepMine' | 'onKeepTheirs' | 'diffMode' | 'diffContent' | 'onToggleDiff' | 'locale'
>) {
  return (
    <>
      {isArchived && onUnarchiveNote && (
        <ArchivedNoteBanner onUnarchive={() => onUnarchiveNote(path)} locale={locale} />
      )}
      {isConflicted && (
        <ConflictNoteBanner
          onKeepMine={() => onKeepMine?.(path)}
          onKeepTheirs={() => onKeepTheirs?.(path)}
          locale={locale}
        />
      )}
      {diffMode && <DiffModeView diffContent={diffContent} locale={locale} onToggleDiff={onToggleDiff} />}
    </>
  )
}

function EditorCanvas({
  showEditor,
  cssVars,
  editor,
  entries,
  onNavigateWikilink,
  onEditorChange,
  isDeletedPreview,
  vaultPath,
}: Pick<
  EditorContentModel,
  | 'showEditor'
  | 'cssVars'
  | 'editor'
  | 'entries'
  | 'onNavigateWikilink'
  | 'onEditorChange'
  | 'isDeletedPreview'
  | 'vaultPath'
>) {
  if (!showEditor) return null

  return (
    <EditorFindScope className="editor-scroll-area" style={cssVars as React.CSSProperties}>
      <div className="editor-content-wrapper">
        <SingleEditorView
          editor={editor}
          entries={entries}
          onNavigateWikilink={onNavigateWikilink}
          onChange={onEditorChange}
          vaultPath={vaultPath}
          editable={!isDeletedPreview}
        />
      </div>
    </EditorFindScope>
  )
}

function EditorFindScope({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  const scopeRef = useRef<HTMLDivElement | null>(null)
  const syncAvailability = useCallback(() => {
    const activeElement = document.activeElement
    const enabled = activeElement instanceof Node
      && scopeRef.current?.contains(activeElement) === true
    dispatchEditorFindAvailability(enabled)
  }, [])

  useEffect(() => () => dispatchEditorFindAvailability(false), [])

  return (
    <div
      ref={scopeRef}
      className={className}
      data-editor-find-scope="true"
      onFocusCapture={() => dispatchEditorFindAvailability(true)}
      onBlurCapture={() => requestAnimationFrame(syncAvailability)}
      style={style}
    >
      {children}
    </div>
  )
}

export function EditorContentLayout(model: EditorContentModel) {
  const {
    activeTab,
    loadingTab,
    isLoadingNewTab,
    entries,
    editor,
    diffMode,
    diffContent,
    onToggleDiff,
    effectiveRawMode,
    onRawContentChange,
    onSave,
    showEditor,
    isArchived,
    onUnarchiveNote,
    path,
    isConflicted,
    onKeepMine,
    onKeepTheirs,
    breadcrumbBarRef,
    wordCount,
    vaultPath,
    cssVars,
    onNavigateWikilink,
    onEditorChange,
    isDeletedPreview,
    rawLatestContentRef,
    rawModeContent,
    noteWidth,
    findRequest,
    locale,
    isVaultLoading,
  } = model
  const rootClassName = cn(
    'flex flex-1 flex-col min-w-0 min-h-0',
    noteWidth === 'wide' ? 'editor-content-width--wide' : 'editor-content-width--normal',
  )
  const chromeTab = activeTab ?? loadingTab
  const chromePath = chromeTab?.entry.path ?? path
  const chromeWordCount = activeTab ? wordCount : 0
  const showActiveContent = activeTab && !isVaultLoading
  const showLoadingContent = isVaultLoading || (isLoadingNewTab && showEditor)
  const breadcrumbActions = buildBreadcrumbActions(model)

  return (
    <div className={rootClassName}>
      <EditorBreadcrumbArea
        actions={breadcrumbActions}
        barRef={breadcrumbBarRef}
        chromePath={chromePath}
        chromeTab={chromeTab}
        chromeWordCount={chromeWordCount}
        isVaultLoading={isVaultLoading}
        locale={locale}
      />
      {showActiveContent && (
        <>
          <EditorChrome
            isArchived={isArchived}
            onUnarchiveNote={onUnarchiveNote}
            path={path}
            isConflicted={isConflicted}
            onKeepMine={onKeepMine}
            onKeepTheirs={onKeepTheirs}
            diffMode={diffMode}
            diffContent={diffContent}
            onToggleDiff={onToggleDiff}
            locale={locale}
          />
          <RawModeEditorSection
            activeTab={activeTab}
            entries={entries}
            findRequest={findRequest}
            rawMode={effectiveRawMode}
            rawModeContent={rawModeContent}
            onRawContentChange={onRawContentChange}
            onSave={onSave}
            rawLatestContentRef={rawLatestContentRef}
            vaultPath={vaultPath}
            locale={locale}
          />
          <EditorCanvas
            showEditor={showEditor}
            cssVars={cssVars}
            vaultPath={vaultPath}
            editor={editor}
            entries={entries}
            onNavigateWikilink={onNavigateWikilink}
            onEditorChange={onEditorChange}
            isDeletedPreview={isDeletedPreview}
          />
        </>
      )}
      {showLoadingContent && <EditorLoadingCanvas cssVars={cssVars} />}
    </div>
  )
}
