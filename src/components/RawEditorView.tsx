import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { trackEvent } from '../lib/telemetry'
import type { EditorView } from '@codemirror/view'
import { MIN_QUERY_LENGTH } from '../utils/wikilinkSuggestions'
import { buildTypeEntryMap } from '../utils/typeColors'
import { NoteSearchList } from './NoteSearchList'
import {
  buildRawEditorAutocompleteState,
  buildRawEditorBaseItems,
  detectYamlError,
  extractWikilinkQuery,
  getRawEditorDropdownPosition,
  replaceActiveWikilinkQuery,
  type RawEditorAutocompleteState,
} from '../utils/rawEditorUtils'
import { useCodeMirror } from '../hooks/useCodeMirror'
import type { VaultEntry } from '../types'
import { translate, type AppLocale } from '../lib/i18n'
import { RawEditorFindBar, type RawEditorFindRequest } from './RawEditorFindBar'

export interface RawEditorViewProps {
  content: string
  path: string
  entries: VaultEntry[]
  onContentChange: (path: string, content: string) => void
  vaultPath?: string
  onSave: () => void
  /** Mutable ref updated on every keystroke with the latest doc string.
   *  Allows the parent to flush debounced content before unmount. */
  latestContentRef?: React.MutableRefObject<string | null>
  locale?: AppLocale
  findRequest?: RawEditorFindRequest | null
}

const DEBOUNCE_MS = 500
const DROPDOWN_MAX_HEIGHT = 200

type PendingChangeRefs = {
  debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  latestDocRef: React.MutableRefObject<string>
  onContentChangeRef: React.MutableRefObject<RawEditorViewProps['onContentChange']>
  pathRef: React.MutableRefObject<string>
}

function useLatestRef<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  useEffect(() => { ref.current = value }, [value])
  return ref
}

function flushPendingRawEditorChange({
  debounceRef,
  latestDocRef,
  onContentChangeRef,
  pathRef,
}: PendingChangeRefs): void {
  if (!debounceRef.current) return

  clearTimeout(debounceRef.current)
  debounceRef.current = null
  onContentChangeRef.current(pathRef.current, latestDocRef.current)
}

function moveRawEditorAutocompleteSelection(
  autocomplete: RawEditorAutocompleteState,
  direction: 'next' | 'previous',
): RawEditorAutocompleteState {
  const selectedIndex = direction === 'next'
    ? Math.min(autocomplete.selectedIndex + 1, autocomplete.items.length - 1)
    : Math.max(autocomplete.selectedIndex - 1, 0)

  return { ...autocomplete, selectedIndex }
}

function RawEditorYamlErrorBanner({ error }: { error: string | null }) {
  if (!error) return null

  return (
    <div
      className="flex items-center gap-2 px-4 py-2 text-xs border-b shrink-0"
      style={{
        background: 'var(--feedback-warning-bg)',
        borderColor: 'var(--feedback-warning-border)',
        color: 'var(--feedback-warning-text)',
      }}
      role="alert"
      data-testid="raw-editor-yaml-error"
    >
      <span style={{ fontWeight: 600 }}>YAML error:</span>
      <span>{error}</span>
    </div>
  )
}

function RawEditorAutocompleteDropdown({
  autocomplete,
  onItemHover,
  position,
}: {
  autocomplete: RawEditorAutocompleteState | null
  onItemHover: (index: number) => void
  position: { top: number; left: number }
}) {
  if (!autocomplete || autocomplete.items.length === 0) return null

  return (
    <div
      className="fixed z-50 min-w-64 max-w-xs overflow-auto rounded-md border shadow-[0_12px_30px_var(--shadow-dialog)]"
      style={{
        top: position.top,
        left: position.left,
        maxHeight: DROPDOWN_MAX_HEIGHT,
        background: 'var(--popover)',
        borderColor: 'var(--border)',
      }}
      data-testid="raw-editor-wikilink-dropdown"
    >
      <NoteSearchList
        items={autocomplete.items}
        selectedIndex={autocomplete.selectedIndex}
        getItemKey={(item, i) => `${item.title}-${item.path ?? i}`}
        onItemClick={(item) => item.onItemClick()}
        onItemHover={onItemHover}
      />
    </div>
  )
}

type RawEditorPendingChanges = PendingChangeRefs & {
  handleDocChange: (doc: string) => void
  handleSave: () => void
  yamlError: string | null
}

function useRawEditorPendingChanges({
  content,
  latestContentRef,
  onContentChange,
  onSave,
  path,
}: Pick<RawEditorViewProps, 'content' | 'latestContentRef' | 'onContentChange' | 'onSave' | 'path'>): RawEditorPendingChanges {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathRef = useLatestRef(path)
  const onContentChangeRef = useLatestRef(onContentChange)
  const onSaveRef = useLatestRef(onSave)
  const latestContentRefStable = useRef(latestContentRef)
  const latestDocRef = useRef(content)
  const [yamlError, setYamlError] = useState<string | null>(() => detectYamlError(content))

  useEffect(() => { if (latestContentRef) latestContentRef.current = content }, [latestContentRef, content])
  useEffect(() => { latestContentRefStable.current = latestContentRef }, [latestContentRef])

  const handleDocChange = useCallback((doc: string) => {
    latestDocRef.current = doc
    if (latestContentRefStable.current) latestContentRefStable.current.current = doc
    setYamlError(detectYamlError(doc))
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onContentChangeRef.current(pathRef.current, doc)
    }, DEBOUNCE_MS)
  }, [latestContentRefStable, onContentChangeRef, pathRef])

  const handleSave = useCallback(() => {
    flushPendingRawEditorChange({ debounceRef, latestDocRef, onContentChangeRef, pathRef })
    onSaveRef.current()
  }, [onContentChangeRef, onSaveRef, pathRef])

  useEffect(() => {
    return () => {
      flushPendingRawEditorChange({ debounceRef, latestDocRef, onContentChangeRef, pathRef })
    }
  }, [onContentChangeRef, pathRef])

  return {
    debounceRef,
    handleDocChange,
    handleSave,
    latestDocRef,
    onContentChangeRef,
    pathRef,
    yamlError,
  }
}

type RawEditorAutocompleteDirection = 'next' | 'previous'
type RawEditorSetAutocomplete = React.Dispatch<React.SetStateAction<RawEditorAutocompleteState | null>>
type RawEditorTypeEntryMap = ReturnType<typeof buildTypeEntryMap>

function getRawEditorAutocompleteDirection(key: string): RawEditorAutocompleteDirection | null {
  if (key === 'ArrowDown') return 'next'
  if (key === 'ArrowUp') return 'previous'
  return null
}

function buildNextRawEditorAutocomplete({
  baseItems,
  insertWikilinkRef,
  typeEntryMap,
  vaultPath,
  view,
}: {
  baseItems: ReturnType<typeof buildRawEditorBaseItems>
  insertWikilinkRef: React.MutableRefObject<(target: string) => void>
  typeEntryMap: RawEditorTypeEntryMap
  vaultPath?: string
  view: EditorView
}): RawEditorAutocompleteState | null {
  const doc = view.state.doc.toString()
  const cursor = view.state.selection.main.head
  const query = extractWikilinkQuery(doc, cursor)
  if (query === null || query.length < MIN_QUERY_LENGTH) return null

  return buildRawEditorAutocompleteState({
    view,
    baseItems,
    query,
    typeEntryMap,
    onInsertTarget: (target: string) => insertWikilinkRef.current(target),
    vaultPath: vaultPath ?? '',
  })
}

function useRawEditorAutocompleteEscape(
  autocomplete: RawEditorAutocompleteState | null,
  setAutocomplete: RawEditorSetAutocomplete,
) {
  return useCallback(() => {
    if (autocomplete) { setAutocomplete(null); return true }
    return false
  }, [autocomplete, setAutocomplete])
}

function useRawEditorAutocompleteKeyboard(
  autocomplete: RawEditorAutocompleteState | null,
  setAutocomplete: RawEditorSetAutocomplete,
) {
  return useCallback((e: React.KeyboardEvent) => {
    if (!autocomplete) return

    if (e.key === 'Enter') {
      e.preventDefault()
      autocomplete.items[autocomplete.selectedIndex]?.onItemClick()
      return
    }

    const direction = getRawEditorAutocompleteDirection(e.key)
    if (!direction) return

    e.preventDefault()
    setAutocomplete(prev => prev ? moveRawEditorAutocompleteSelection(prev, direction) : null)
  }, [autocomplete, setAutocomplete])
}

function useRawEditorAutocompleteController({
  entries,
  vaultPath,
}: Pick<RawEditorViewProps, 'entries' | 'vaultPath'>) {
  const [autocomplete, setAutocomplete] = useState<RawEditorAutocompleteState | null>(null)
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const baseItems = useMemo(() => buildRawEditorBaseItems(entries), [entries])
  const insertWikilinkRef = useRef<(target: string) => void>(() => {})

  const handleCursorActivity = useCallback((view: EditorView) => {
    setAutocomplete(buildNextRawEditorAutocomplete({
      baseItems,
      insertWikilinkRef,
      typeEntryMap,
      vaultPath,
      view,
    }))
  }, [baseItems, typeEntryMap, vaultPath])

  const handleItemHover = useCallback((index: number) => {
    setAutocomplete(prev => prev ? { ...prev, selectedIndex: index } : null)
  }, [])

  const handleEscape = useRawEditorAutocompleteEscape(autocomplete, setAutocomplete)
  const handleAutocompleteKey = useRawEditorAutocompleteKeyboard(autocomplete, setAutocomplete)

  return {
    autocomplete,
    handleAutocompleteKey,
    handleCursorActivity,
    handleEscape,
    handleItemHover,
    insertWikilinkRef,
    setAutocomplete,
  }
}

function useRawEditorWikilinkInsertion({
  debounceRef,
  insertWikilinkRef,
  latestDocRef,
  onContentChangeRef,
  pathRef,
  setAutocomplete,
  viewRef,
}: PendingChangeRefs & {
  insertWikilinkRef: React.MutableRefObject<(target: string) => void>
  setAutocomplete: RawEditorSetAutocomplete
  viewRef: React.MutableRefObject<EditorView | null>
}) {
  const applyWikilinkChange = useCallback((view: EditorView, next: { text: string; cursor: number }) => {
    const doc = view.state.doc.toString()

    view.dispatch({
      changes: { from: 0, to: doc.length, insert: next.text },
      selection: { anchor: next.cursor },
    })
    trackEvent('wikilink_inserted')
    setAutocomplete(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = null
    latestDocRef.current = next.text
    onContentChangeRef.current(pathRef.current, next.text)

    view.focus()
  }, [debounceRef, latestDocRef, onContentChangeRef, pathRef, setAutocomplete])

  const insertAutocompleteWikilink = useCallback((target: string) => {
    const view = viewRef.current
    if (!view) return

    const cursor = view.state.selection.main.head
    const doc = view.state.doc.toString()
    const replacement = replaceActiveWikilinkQuery(doc, cursor, target)
    if (!replacement) return

    applyWikilinkChange(view, replacement)
  }, [applyWikilinkChange, viewRef])

  useEffect(() => { insertWikilinkRef.current = insertAutocompleteWikilink }, [insertAutocompleteWikilink, insertWikilinkRef])
}

export function RawEditorView({ content, path, entries, onContentChange, onSave, latestContentRef, vaultPath, locale = 'en', findRequest }: RawEditorViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rawDoc, setRawDoc] = useState(content)
  const [findOpen, setFindOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const pendingChanges = useRawEditorPendingChanges({ content, latestContentRef, onContentChange, onSave, path })
  const {
    autocomplete,
    handleAutocompleteKey,
    handleCursorActivity,
    handleEscape: handleAutocompleteEscape,
    handleItemHover,
    insertWikilinkRef,
    setAutocomplete,
  } = useRawEditorAutocompleteController({ entries, vaultPath })
  const handleDocChange = useCallback((doc: string) => {
    setRawDoc(doc)
    pendingChanges.handleDocChange(doc)
  }, [pendingChanges])
  const handleEscape = useCallback(() => {
    if (handleAutocompleteEscape()) return true
    if (!findOpen) return false

    setFindOpen(false)
    return true
  }, [findOpen, handleAutocompleteEscape])
  const viewRef = useCodeMirror(containerRef, content, {
    onDocChange: handleDocChange,
    onCursorActivity: handleCursorActivity,
    onSave: pendingChanges.handleSave,
    onEscape: handleEscape,
  })

  useRawEditorWikilinkInsertion({
    debounceRef: pendingChanges.debounceRef,
    insertWikilinkRef,
    latestDocRef: pendingChanges.latestDocRef,
    onContentChangeRef: pendingChanges.onContentChangeRef,
    pathRef: pendingChanges.pathRef,
    setAutocomplete,
    viewRef,
  })

  useEffect(() => {
    setRawDoc(content)
  }, [content])

  useEffect(() => {
    if (!findRequest || findRequest.path !== path) return
    setAutocomplete(null)
    setFindOpen(true)
    setReplaceOpen(findRequest.replace)
  }, [findRequest, path, setAutocomplete])

  const dropdownPosition = getRawEditorDropdownPosition(autocomplete, DROPDOWN_MAX_HEIGHT, window)

  return (
    <div className="flex flex-1 flex-col min-h-0 relative" style={{ background: 'var(--background)' }} onKeyDown={handleAutocompleteKey} role="presentation">
      <RawEditorYamlErrorBanner error={pendingChanges.yamlError} />
      <RawEditorFindBar
        doc={rawDoc}
        locale={locale}
        onClose={() => setFindOpen(false)}
        onReplaceOpenChange={setReplaceOpen}
        open={findOpen}
        path={path}
        replaceOpen={replaceOpen}
        request={findRequest}
        viewRef={viewRef}
      />
      <div
        ref={containerRef}
        className="raw-editor-codemirror flex flex-1 min-h-0"
        data-testid="raw-editor-codemirror"
        aria-label={translate(locale, 'editor.raw.label')}
      />
      <RawEditorAutocompleteDropdown
        autocomplete={autocomplete}
        onItemHover={handleItemHover}
        position={dropdownPosition}
      />
    </div>
  )
}
