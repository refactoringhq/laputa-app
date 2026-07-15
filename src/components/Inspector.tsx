import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultEntry, GitCommit, WorkspaceIdentity } from '../types'
import { cn } from '@/lib/utils'
import { Separator } from './ui/separator'
import { parseFrontmatter, detectFrontmatterState, detectFrontmatterWarnings } from '../utils/frontmatter'
import { DynamicPropertiesPanel } from './DynamicPropertiesPanel'
import type { FrontmatterOpOptions } from '../hooks/frontmatterOps'
import {
  DynamicRelationshipsPanel,
  BacklinksPanel,
  ReferencedByPanel,
  GitHistoryPanel,
  InstancesPanel,
  NoteInfoPanel,
} from './InspectorPanels'
import { normalizeNotePathForIdentity } from '../utils/notePathIdentity'
import { EmptyInspector, InitializePropertiesPrompt, InspectorHeader, InvalidFrontmatterNotice } from './inspector/InspectorChrome'
import { useBacklinks, useReferencedBy } from './inspector/useInspectorData'
import { useInspectorFocusBoundary } from '../hooks/editorFocusOwnership'
import { useInspectorPropertyActions } from './inspector/useInspectorPropertyActions'
import type { AppLocale } from '../lib/i18n'

export type FrontmatterValue = string | number | boolean | string[] | null

const INSPECTOR_REFERENCE_DELAY_MS = 150

interface InspectorProps {
  collapsed: boolean
  onToggle: () => void
  entry: VaultEntry | null
  content: string | null
  entries: VaultEntry[]
  gitHistory: GitCommit[]
  vaultPath?: string
  onNavigate: (target: string) => void
  onViewCommitDiff?: (commitHash: string) => void
  onUpdateFrontmatter?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onDeleteProperty?: (path: string, key: string, options?: FrontmatterOpOptions) => Promise<void>
  onAddProperty?: (path: string, key: string, value: FrontmatterValue, options?: FrontmatterOpOptions) => Promise<void>
  onCreateMissingType?: (path: string, missingType: string, nextTypeName: string) => Promise<boolean | void>
  onCreateAndOpenNote?: (title: string) => Promise<boolean>
  onChangeWorkspace?: (entry: VaultEntry, workspace: WorkspaceIdentity) => Promise<void> | void
  onInitializeProperties?: (path: string) => void
  onToggleRawEditor?: () => void
  workspaces?: WorkspaceIdentity[]
  locale?: AppLocale
}

function buildTypeEntryMap(entries: VaultEntry[]): Record<string, VaultEntry> {
  const map: Record<string, VaultEntry> = {}
  for (const candidate of entries) {
    if (candidate.isA === 'Type') map[candidate.title] = candidate
  }
  return map
}

function supportsFrontmatter(entry: VaultEntry): boolean {
  return entry.fileKind === undefined || entry.fileKind === 'markdown'
}

function pathBelongsToWorkspace(path: string, workspace: WorkspaceIdentity): boolean {
  const normalizedPath = normalizeNotePathForIdentity(path)
  const normalizedWorkspacePath = normalizeNotePathForIdentity(workspace.path)
  if (!normalizedWorkspacePath) return false
  return normalizedPath === normalizedWorkspacePath || normalizedPath.startsWith(`${normalizedWorkspacePath}/`)
}

function inferEntryWorkspace(entry: VaultEntry, workspaces: WorkspaceIdentity[] | undefined): WorkspaceIdentity | undefined {
  if (entry.workspace) return entry.workspace
  return workspaces
    ?.filter((workspace) => pathBelongsToWorkspace(entry.path, workspace))
    .sort((left, right) => right.path.length - left.path.length)
    .at(0)
}

function entryWithInferredWorkspace(entry: VaultEntry, workspaces: WorkspaceIdentity[] | undefined): VaultEntry {
  const workspace = inferEntryWorkspace(entry, workspaces)
  return workspace && workspace !== entry.workspace ? { ...entry, workspace } : entry
}

interface DeferredInspectorReferenceKey {
  entries: VaultEntry[]
  entry: VaultEntry
}

function scheduleInspectorReferences(callback: () => void): () => void {
  const requestIdle = typeof window !== 'undefined' ? window.requestIdleCallback?.bind(window) : undefined
  if (typeof requestIdle === 'function') {
    const id = requestIdle(callback, { timeout: 1_000 })
    return () => window.cancelIdleCallback?.(id)
  }

  const id = window.setTimeout(callback, INSPECTOR_REFERENCE_DELAY_MS)
  return () => window.clearTimeout(id)
}

function useDeferredInspectorReferences(entry: VaultEntry, entries: VaultEntry[]): boolean {
  const [readyFor, setReadyFor] = useState<DeferredInspectorReferenceKey | null>(null)

  useEffect(() => {
    let cancelled = false
    const cancel = scheduleInspectorReferences(() => {
      if (!cancelled) setReadyFor({ entries, entry })
    })

    return () => {
      cancelled = true
      cancel()
    }
  }, [entries, entry])

  return readyFor?.entry === entry && readyFor.entries === entries
}

function ValidFrontmatterPanels({
  entry,
  entries,
  frontmatter,
  typeEntryMap,
  vaultPath,
  onNavigate,
  onCreateAndOpenNote,
  onUpdateProperty,
  onUpdatePropertyAfterCreate,
  onDeleteProperty,
  onAddProperty,
  onAddPropertyAfterCreate,
  onCreateMissingType,
  onChangeWorkspace,
  workspaces,
  locale,
}: {
  entry: VaultEntry
  entries: VaultEntry[]
  frontmatter: ReturnType<typeof parseFrontmatter>
  typeEntryMap: Record<string, VaultEntry>
  vaultPath?: string
  onNavigate: (target: string) => void
  onCreateAndOpenNote?: (title: string) => Promise<boolean>
  onUpdateProperty?: (key: string, value: FrontmatterValue) => void
  onUpdatePropertyAfterCreate?: (key: string, value: FrontmatterValue) => void
  onDeleteProperty?: (key: string) => void
  onAddProperty?: (key: string, value: FrontmatterValue) => void
  onAddPropertyAfterCreate?: (key: string, value: FrontmatterValue) => void
  onCreateMissingType?: (typeName: string) => Promise<boolean | void>
  onChangeWorkspace?: (entry: VaultEntry, workspace: WorkspaceIdentity) => Promise<void> | void
  workspaces?: WorkspaceIdentity[]
  locale: AppLocale
}) {
  const entryForWorkspaceActions = entryWithInferredWorkspace(entry, workspaces)
  return (
    <>
      <DynamicPropertiesPanel
        entry={entryForWorkspaceActions}
        frontmatter={frontmatter}
        entries={entries}
        onUpdateProperty={onUpdateProperty}
        onDeleteProperty={onDeleteProperty}
        onAddProperty={onAddProperty}
        onNavigate={onNavigate}
        onCreateMissingType={onCreateMissingType}
        onChangeWorkspace={onChangeWorkspace ? (workspace) => onChangeWorkspace(entryForWorkspaceActions, workspace) : undefined}
        workspaces={workspaces}
        locale={locale}
      />
      <Separator data-testid="inspector-properties-relationships-separator" />
      <DynamicRelationshipsPanel
        entry={entry}
        frontmatter={frontmatter}
        entries={entries}
        typeEntryMap={typeEntryMap}
        vaultPath={vaultPath}
        onNavigate={onNavigate}
        onAddProperty={onAddProperty}
        onAddPropertyAfterCreate={onAddPropertyAfterCreate}
        onUpdateProperty={onUpdateProperty}
        onUpdatePropertyAfterCreate={onUpdatePropertyAfterCreate}
        onDeleteProperty={onDeleteProperty}
        onCreateAndOpenNote={onCreateAndOpenNote}
        locale={locale}
      />
    </>
  )
}

function InspectorReferencePanels({
  entries,
  entry,
  onNavigate,
  typeEntryMap,
}: {
  entries: VaultEntry[]
  entry: VaultEntry
  onNavigate: (target: string) => void
  typeEntryMap: Record<string, VaultEntry>
}) {
  const referencedBy = useReferencedBy(entry, entries)
  const backlinks = useBacklinks(entry, entries, referencedBy)

  return (
    <>
      <InstancesPanel entry={entry} entries={entries} typeEntryMap={typeEntryMap} onNavigate={onNavigate} />
      <ReferencedByPanel items={referencedBy} typeEntryMap={typeEntryMap} onNavigate={onNavigate} />
      {backlinks.length > 0 && <Separator />}
      <BacklinksPanel backlinks={backlinks} onNavigate={onNavigate} />
    </>
  )
}

function DeferredInspectorReferencePanels(props: {
  entries: VaultEntry[]
  entry: VaultEntry
  onNavigate: (target: string) => void
  typeEntryMap: Record<string, VaultEntry>
}) {
  const ready = useDeferredInspectorReferences(props.entry, props.entries)
  return ready ? <InspectorReferencePanels {...props} /> : null
}

function PrimaryInspectorPanel({
  entry,
  frontmatterState,
  frontmatter,
  entries,
  typeEntryMap,
  vaultPath,
  onNavigate,
  onToggleRawEditor,
  onInitializeProperties,
  onCreateAndOpenNote,
  onUpdateProperty,
  onUpdatePropertyAfterCreate,
  onDeleteProperty,
  onAddProperty,
  onAddPropertyAfterCreate,
  onCreateMissingType,
  onChangeWorkspace,
  workspaces,
  locale,
}: {
  entry: VaultEntry
  frontmatterState: ReturnType<typeof detectFrontmatterState>
  frontmatter: ReturnType<typeof parseFrontmatter>
  entries: VaultEntry[]
  typeEntryMap: Record<string, VaultEntry>
  vaultPath?: string
  onNavigate: (target: string) => void
  onToggleRawEditor?: () => void
  onInitializeProperties?: (path: string) => void
  onCreateAndOpenNote?: (title: string) => Promise<boolean>
  onUpdateProperty?: (key: string, value: FrontmatterValue) => void
  onUpdatePropertyAfterCreate?: (key: string, value: FrontmatterValue) => void
  onDeleteProperty?: (key: string) => void
  onAddProperty?: (key: string, value: FrontmatterValue) => void
  onAddPropertyAfterCreate?: (key: string, value: FrontmatterValue) => void
  onCreateMissingType?: (typeName: string) => Promise<boolean | void>
  onChangeWorkspace?: (entry: VaultEntry, workspace: WorkspaceIdentity) => Promise<void> | void
  workspaces?: WorkspaceIdentity[]
  locale: AppLocale
}) {
  if (frontmatterState === 'valid') {
    return (
      <ValidFrontmatterPanels
        entry={entry}
        entries={entries}
        frontmatter={frontmatter}
        typeEntryMap={typeEntryMap}
        vaultPath={vaultPath}
        onNavigate={onNavigate}
        onCreateAndOpenNote={onCreateAndOpenNote}
        onUpdateProperty={onUpdateProperty}
        onUpdatePropertyAfterCreate={onUpdatePropertyAfterCreate}
        onDeleteProperty={onDeleteProperty}
        onAddProperty={onAddProperty}
        onAddPropertyAfterCreate={onAddPropertyAfterCreate}
        onCreateMissingType={onCreateMissingType}
        onChangeWorkspace={onChangeWorkspace}
        workspaces={workspaces}
        locale={locale}
      />
    )
  }

  if (frontmatterState === 'invalid') {
    return onToggleRawEditor ? <InvalidFrontmatterNotice locale={locale} onFix={onToggleRawEditor} /> : null
  }

  return onInitializeProperties ? <InitializePropertiesPrompt locale={locale} onClick={() => onInitializeProperties(entry.path)} /> : null
}

function InspectorBody({
  entry,
  entries,
  content,
  gitHistory,
  vaultPath,
  onNavigate,
  onViewCommitDiff,
  onUpdateFrontmatter,
  onDeleteProperty,
  onAddProperty,
  onCreateMissingType,
  onChangeWorkspace,
  onCreateAndOpenNote,
  onInitializeProperties,
  onToggleRawEditor,
  workspaces,
  locale = 'en',
}: Omit<InspectorProps, 'collapsed' | 'onToggle'>) {
  const frontmatter = useMemo(() => parseFrontmatter(content), [content])
  const frontmatterState = useMemo(() => detectFrontmatterState(content), [content])
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const {
    handleUpdateProperty,
    handleUpdatePropertyAfterCreate,
    handleDeleteProperty,
    handleAddProperty,
    handleAddPropertyAfterCreate,
    handleCreateMissingType,
  } = useInspectorPropertyActions({
    entry,
    onUpdateFrontmatter,
    onDeleteProperty,
    onAddProperty,
    onCreateMissingType,
  })

  if (!entry) {
    return <EmptyInspector locale={locale} />
  }

  return (
    <>
      {supportsFrontmatter(entry) && (
        <PrimaryInspectorPanel
          entry={entry}
          frontmatterState={frontmatterState}
          frontmatter={frontmatter}
          entries={entries}
          typeEntryMap={typeEntryMap}
          vaultPath={vaultPath}
          onNavigate={onNavigate}
          onToggleRawEditor={onToggleRawEditor}
          onInitializeProperties={onInitializeProperties}
          onCreateAndOpenNote={onCreateAndOpenNote}
          onUpdateProperty={handleUpdateProperty}
          onUpdatePropertyAfterCreate={handleUpdatePropertyAfterCreate}
          onDeleteProperty={handleDeleteProperty}
          onAddProperty={handleAddProperty}
          onAddPropertyAfterCreate={handleAddPropertyAfterCreate}
          onCreateMissingType={handleCreateMissingType}
          onChangeWorkspace={onChangeWorkspace}
          workspaces={workspaces}
          locale={locale}
        />
      )}
      <DeferredInspectorReferencePanels
        entries={entries}
        entry={entry}
        onNavigate={onNavigate}
        typeEntryMap={typeEntryMap}
      />
      <Separator />
      <NoteInfoPanel entry={entry} content={content} locale={locale} />
      {gitHistory.length > 0 && <Separator />}
      <GitHistoryPanel commits={gitHistory} onViewCommitDiff={onViewCommitDiff} />
    </>
  )
}

export function Inspector({ collapsed, onToggle, ...bodyProps }: InspectorProps) {
  const inspectorRef = useRef<HTMLElement | null>(null)
  useInspectorFocusBoundary(inspectorRef)
  const frontmatterWarnings = useMemo(
    () => detectFrontmatterWarnings(bodyProps.content),
    [bodyProps.content],
  )

  return (
    <aside
      ref={inspectorRef}
      className={cn('flex flex-1 flex-col overflow-hidden border-l border-border bg-background text-foreground transition-[width] duration-200', collapsed && '!w-10 !min-w-10')}
    >
      <InspectorHeader
        collapsed={collapsed}
        frontmatterWarnings={frontmatterWarnings}
        locale={bodyProps.locale}
        onToggle={onToggle}
        onOpenRawEditor={bodyProps.onToggleRawEditor}
      />
      {!collapsed && (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
          <InspectorBody {...bodyProps} />
        </div>
      )}
    </aside>
  )
}
