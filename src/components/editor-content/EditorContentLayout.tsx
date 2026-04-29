import type React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { translate, type AppLocale } from '../../lib/i18n'
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

function EditorLoadingSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-8 animate-pulse" style={{ minHeight: 0 }}>
      <div className="h-6 w-2/5 rounded bg-muted" />
      <div className="h-4 w-4/5 rounded bg-muted" />
      <div className="h-4 w-3/5 rounded bg-muted" />
      <div className="h-4 w-4/5 rounded bg-muted" />
      <div className="h-4 w-2/5 rounded bg-muted" />
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
}: {
  activeTab: NonNullable<EditorContentModel['activeTab']>
  barRef: React.RefObject<HTMLDivElement | null>
  wordCount: number
  path: string
  actions: BreadcrumbActions
  locale?: AppLocale
}) {
  return (
    <BreadcrumbBar
      entry={activeTab.entry}
      wordCount={wordCount}
      barRef={barRef}
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
  } = model
  const rootClassName = cn(
    'flex flex-1 flex-col min-w-0 min-h-0',
    noteWidth === 'wide' ? 'editor-content-width--wide' : 'editor-content-width--normal',
  )

  if (!activeTab) {
    return (
      <div className={rootClassName}>
        {isLoadingNewTab && showEditor && <EditorLoadingSkeleton />}
      </div>
    )
  }

  return (
    <div className={rootClassName}>
      <ActiveTabBreadcrumb
        activeTab={activeTab}
        barRef={breadcrumbBarRef}
        wordCount={wordCount}
        path={path}
        locale={locale}
        actions={{
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
        }}
      />
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
      {isLoadingNewTab && showEditor && <EditorLoadingSkeleton />}
    </div>
  )
}
