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
import type { AppLocale } from '../lib/i18n'
import { RawEditorFindBar, type RawEditorFindRequest } from './RawEditorFindBar'
import {
  activatePlainTextPasteTarget,
  registerPlainTextPasteTarget,
  type PlainTextPasteTarget,
} from '../utils/plainTextPaste'
import { rawEditorLanguageIdForPath } from '../utils/rawEditorLanguage'
import {
  clipboardRemoteImages,
  importRemoteImages,
  rawRemoteImagePasteText,
  replaceImportedRemoteImages,
  type RemoteImageImportResult,
} from '../utils/remoteImagePaste'

export interface RawEditorViewProps {
  content: string
  path: string
  entries: VaultEntry[]
  sourceEntry?: VaultEntry
  onContentChange: (path: string, content: string) => void
  vaultPath?: string
  onSave: () => void
  /** Mutable ref updated on every keystroke with the latest doc string.
   *  Allows the parent to flush debounced content before unmount. */
  latestContentRef?: React.MutableRefObject<string | null>
  locale?: AppLocale
  findRequest?: RawEditorFindRequest | null
  onImageImportResult?: (result: Pick<RemoteImageImportResult, 'failedCount' | 'totalCount'>) => void
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
  useEffect(() => {
    ref.current = value
  }, [value])
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
  const selectedIndex =
    direction === 'next'
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
}: Pick<
  RawEditorViewProps,
  'content' | 'latestContentRef' | 'onContentChange' | 'onSave' | 'path'
>): RawEditorPendingChanges {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pathRef = useLatestRef(path)
  const onContentChangeRef = useLatestRef(onContentChange)
  const onSaveRef = useLatestRef(onSave)
  const latestContentRefStable = useRef(latestContentRef)
  const latestDocRef = useRef(content)
  const [yamlError, setYamlError] = useState<string | null>(() => detectYamlError(content))

  useEffect(() => {
    if (latestContentRef) latestContentRef.current = content
  }, [latestContentRef, content])
  useEffect(() => {
    latestContentRefStable.current = latestContentRef
  }, [latestContentRef])

  const handleDocChange = useCallback(
    (doc: string) => {
    latestDocRef.current = doc
    if (latestContentRefStable.current) latestContentRefStable.current.current = doc
    setYamlError(detectYamlError(doc))
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onContentChangeRef.current(pathRef.current, doc)
    }, DEBOUNCE_MS)
    },
    [onContentChangeRef, pathRef],
  )

  const handleSave = useCallback(() => {
    flushPendingRawEditorChange({
      debounceRef,
      latestDocRef,
      onContentChangeRef,
      pathRef,
    })
    onSaveRef.current()
  }, [onContentChangeRef, onSaveRef, pathRef])

  useEffect(() => {
    return () => {
      flushPendingRawEditorChange({
        debounceRef,
        latestDocRef,
        onContentChangeRef,
        pathRef,
      })
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
  sourceEntry,
  typeEntryMap,
  vaultPath,
  view,
}: {
  baseItems: ReturnType<typeof buildRawEditorBaseItems>
  insertWikilinkRef: React.MutableRefObject<(target: string) => void>
  sourceEntry?: VaultEntry
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
    sourceEntry,
    vaultPath: vaultPath ?? '',
  })
}

function useRawEditorAutocompleteEscape(
  autocomplete: RawEditorAutocompleteState | null,
  setAutocomplete: RawEditorSetAutocomplete,
) {
  return useCallback(() => {
    if (autocomplete) {
      setAutocomplete(null)
      return true
    }
    return false
  }, [autocomplete, setAutocomplete])
}

function useRawEditorAutocompleteKeyboard(
  autocomplete: RawEditorAutocompleteState | null,
  setAutocomplete: RawEditorSetAutocomplete,
) {
  return useCallback(
    (e: Pick<KeyboardEvent, 'key' | 'preventDefault'>) => {
    if (!autocomplete) return

    if (e.key === 'Enter') {
      e.preventDefault()
      autocomplete.items[autocomplete.selectedIndex]?.onItemClick()
      return
    }

    const direction = getRawEditorAutocompleteDirection(e.key)
    if (!direction) return

    e.preventDefault()
      setAutocomplete((prev) => (prev ? moveRawEditorAutocompleteSelection(prev, direction) : null))
    },
    [autocomplete, setAutocomplete],
  )
}

function useRawEditorAutocompleteController({
  entries,
  sourceEntry,
  vaultPath,
}: Pick<RawEditorViewProps, 'entries' | 'sourceEntry' | 'vaultPath'>) {
  const [autocomplete, setAutocomplete] = useState<RawEditorAutocompleteState | null>(null)
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const baseItems = useMemo(() => buildRawEditorBaseItems(entries), [entries])
  const insertWikilinkRef = useRef<(target: string) => void>(() => {})

  const handleCursorActivity = useCallback(
    (view: EditorView) => {
      setAutocomplete(
        buildNextRawEditorAutocomplete({
      baseItems,
      insertWikilinkRef,
      sourceEntry,
      typeEntryMap,
      vaultPath,
      view,
        }),
      )
    },
    [baseItems, sourceEntry, typeEntryMap, vaultPath],
  )

  const handleItemHover = useCallback((index: number) => {
    setAutocomplete((prev) => (prev ? { ...prev, selectedIndex: index } : null))
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
  const applyWikilinkChange = useCallback(
    (view: EditorView, next: { text: string; cursor: number }) => {
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
    },
    [debounceRef, latestDocRef, onContentChangeRef, pathRef, setAutocomplete],
  )

  const insertAutocompleteWikilink = useCallback(
    (target: string) => {
    const view = viewRef.current
    if (!view) return

    const cursor = view.state.selection.main.head
    const doc = view.state.doc.toString()
    const replacement = replaceActiveWikilinkQuery(doc, cursor, target)
    if (!replacement) return

    applyWikilinkChange(view, replacement)
    },
    [applyWikilinkChange, viewRef],
  )

  useEffect(() => {
    insertWikilinkRef.current = insertAutocompleteWikilink
  }, [insertAutocompleteWikilink, insertWikilinkRef])
}

function useRawEditorPlainTextPasteTarget({
  containerRef,
  setAutocomplete,
  viewRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  setAutocomplete: RawEditorSetAutocomplete
  viewRef: React.MutableRefObject<EditorView | null>
}) {
  const targetRef = useRef<PlainTextPasteTarget | null>(null)

  useEffect(() => {
    const target: PlainTextPasteTarget = {
      surface: 'raw_editor',
      contains: (element) => Boolean(element && containerRef.current?.contains(element)),
      isConnected: () => containerRef.current?.isConnected === true,
      insert: (text) => {
        const view = viewRef.current
        if (!view) return false

        view.dispatch({
          ...view.state.replaceSelection(text),
          userEvent: 'input.paste',
        })
        setAutocomplete(null)
        view.focus()
        return true
      },
    }
    targetRef.current = target
    const unregister = registerPlainTextPasteTarget(target)

    return () => {
      unregister()
      if (targetRef.current === target) {
        targetRef.current = null
      }
    }
  }, [containerRef, setAutocomplete, viewRef])

  return useCallback(() => {
    if (targetRef.current) {
      activatePlainTextPasteTarget(targetRef.current)
    }
  }, [])
}

function useRawEditorRemoteImagePaste({
  onImageImportResult,
  vaultPath,
  viewRef,
}: Pick<RawEditorViewProps, 'onImageImportResult' | 'vaultPath'> & {
  viewRef: React.MutableRefObject<EditorView | null>
}) {
  return useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
    const view = viewRef.current
    const images = clipboardRemoteImages(event.clipboardData)
    if (!view || !vaultPath || images.length === 0) return

    event.preventDefault()
    event.stopPropagation()
    const insertedText = rawRemoteImagePasteText(event.clipboardData)
    const selection = view.state.selection.main
    const insertedFrom = selection.from
    const insertedTo = insertedFrom + insertedText.length
    view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: insertedText,
        },
      selection: { anchor: insertedTo },
      userEvent: 'input.paste',
    })
    view.focus()

      void importRemoteImages({ images, vaultPath }).then((result) => {
      const importedText = replaceImportedRemoteImages({
        text: insertedText,
        replacements: result.replacements,
      })
        if (
          canRewriteRawImagePaste({
        importedText,
        insertedFrom,
        insertedText,
        insertedTo,
        view,
        viewRef,
          })
        ) {
        view.dispatch({
            changes: {
              from: insertedFrom,
              to: insertedTo,
              insert: importedText,
            },
          userEvent: 'input.paste',
        })
      }
      onImageImportResult?.({
        failedCount: result.failedCount,
        totalCount: result.totalCount,
      })
      trackEvent('remote_images_paste_imported', {
        surface: 'raw_editor',
        total_count: result.totalCount,
        success_count: result.totalCount - result.failedCount,
        failure_count: result.failedCount,
      })
    })
    },
    [onImageImportResult, vaultPath, viewRef],
  )
}

function canRewriteRawImagePaste({
  importedText,
  insertedFrom,
  insertedText,
  insertedTo,
  view,
  viewRef,
}: {
  importedText: string
  insertedFrom: number
  insertedText: string
  insertedTo: number
  view: EditorView
  viewRef: React.MutableRefObject<EditorView | null>
}): boolean {
  if (viewRef.current !== view) return false
  if (importedText === insertedText) return false
  return view.state.doc.sliceString(insertedFrom, insertedTo) === insertedText
}

function useRawEditorDomEvents(
  rootRef: React.RefObject<HTMLDivElement | null>,
  activatePlainTextPaste: () => void,
  handleAutocompleteKey: (event: KeyboardEvent) => void,
): void {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const handleKeyDown = (event: KeyboardEvent) => handleAutocompleteKey(event)
    root.addEventListener('focusin', activatePlainTextPaste)
    root.addEventListener('mousedown', activatePlainTextPaste, { capture: true })
    root.addEventListener('keydown', handleKeyDown)
    return () => {
      root.removeEventListener('focusin', activatePlainTextPaste)
      root.removeEventListener('mousedown', activatePlainTextPaste, { capture: true })
      root.removeEventListener('keydown', handleKeyDown)
    }
  }, [activatePlainTextPaste, handleAutocompleteKey, rootRef])
}

function useRawEditorContentSync(options: {
  content: string
  findRequest?: RawEditorFindRequest | null
  path: string
  setAutocomplete: (value: RawEditorAutocompleteState | null) => void
  setFindOpen: (value: boolean) => void
  setRawDoc: (value: string) => void
  setReplaceOpen: (value: boolean) => void
}): void {
  const { content, findRequest, path, setAutocomplete, setFindOpen, setRawDoc, setReplaceOpen } = options
  useEffect(() => setRawDoc(content), [content, setRawDoc])
  useEffect(() => {
    if (!findRequest || findRequest.path !== path) return
    setAutocomplete(null)
    setFindOpen(true)
    setReplaceOpen(findRequest.replace)
  }, [findRequest, path, setAutocomplete, setFindOpen, setReplaceOpen])
}

interface RawEditorSurfaceProps {
  autocomplete: RawEditorAutocompleteState | null
  containerRef: React.RefObject<HTMLDivElement | null>
  findOpen: boolean
  findRequest?: RawEditorFindRequest | null
  handleItemHover: (index: number) => void
  handleRemoteImagePaste: (event: React.ClipboardEvent<HTMLDivElement>) => void
  locale: AppLocale
  path: string
  pendingChanges: ReturnType<typeof useRawEditorPendingChanges>
  rawDoc: string
  replaceOpen: boolean
  rootRef: React.RefObject<HTMLDivElement | null>
  setFindOpen: (value: boolean) => void
  setReplaceOpen: (value: boolean) => void
  showFrontmatterWarning: boolean
  viewRef: React.MutableRefObject<EditorView | null>
}

function RawEditorSurface(options: RawEditorSurfaceProps) {
  const { autocomplete, containerRef, findOpen, findRequest, handleItemHover, handleRemoteImagePaste, locale, path, pendingChanges, rawDoc, replaceOpen, rootRef, setFindOpen, setReplaceOpen, showFrontmatterWarning, viewRef } = options
  const dropdownPosition = getRawEditorDropdownPosition(autocomplete, DROPDOWN_MAX_HEIGHT, window)
  return (
    <div ref={rootRef} className="flex flex-1 flex-col min-h-0 relative" style={{ background: 'var(--background)' }} onPasteCapture={handleRemoteImagePaste}>
      <RawEditorYamlErrorBanner error={showFrontmatterWarning ? pendingChanges.yamlError : null} />
      <RawEditorFindBar doc={rawDoc} locale={locale} onClose={() => setFindOpen(false)} onReplaceOpenChange={setReplaceOpen} open={findOpen} path={path} replaceOpen={replaceOpen} request={findRequest} viewRef={viewRef} />
      <div ref={containerRef} className="raw-editor-codemirror flex flex-1 min-h-0" data-testid="raw-editor-codemirror" role="presentation" />
      <RawEditorAutocompleteDropdown autocomplete={autocomplete} onItemHover={handleItemHover} position={dropdownPosition} />
    </div>
  )
}

export function RawEditorView(options: RawEditorViewProps) {
  const { content, entries, findRequest, latestContentRef, locale = 'en', onContentChange, onImageImportResult, onSave, path, sourceEntry, vaultPath } = options
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [rawDoc, setRawDoc] = useState(content)
  const [findOpen, setFindOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const showFrontmatterWarning = rawEditorLanguageIdForPath(path) === 'markdown'
  const pendingChanges = useRawEditorPendingChanges({
    content,
    latestContentRef,
    onContentChange,
    onSave,
    path,
  })
  const {
    autocomplete,
    handleAutocompleteKey,
    handleCursorActivity,
    handleEscape: handleAutocompleteEscape,
    handleItemHover,
    insertWikilinkRef,
    setAutocomplete,
  } = useRawEditorAutocompleteController({ entries, sourceEntry, vaultPath })
  const handleDocChange = useCallback(
    (doc: string) => {
    setRawDoc(doc)
    pendingChanges.handleDocChange(doc)
    },
    [pendingChanges],
  )
  const handleEscape = useCallback(() => {
    if (handleAutocompleteEscape()) return true
    if (!findOpen) return false

    setFindOpen(false)
    return true
  }, [findOpen, handleAutocompleteEscape])
  const viewRef = useCodeMirror(
    containerRef,
    content,
    {
    onDocChange: handleDocChange,
    onCursorActivity: handleCursorActivity,
    onSave: pendingChanges.handleSave,
    onEscape: handleEscape,
    },
    path,
  )
  const handleRemoteImagePaste = useRawEditorRemoteImagePaste({
    onImageImportResult,
    vaultPath,
    viewRef,
  })
  const activatePlainTextPaste = useRawEditorPlainTextPasteTarget({
    containerRef,
    setAutocomplete,
    viewRef,
  })
  useRawEditorDomEvents(rootRef, activatePlainTextPaste, handleAutocompleteKey)

  useRawEditorWikilinkInsertion({
    debounceRef: pendingChanges.debounceRef,
    insertWikilinkRef,
    latestDocRef: pendingChanges.latestDocRef,
    onContentChangeRef: pendingChanges.onContentChangeRef,
    pathRef: pendingChanges.pathRef,
    setAutocomplete,
    viewRef,
  })

  useRawEditorContentSync({ content, findRequest, path, setAutocomplete, setFindOpen, setRawDoc, setReplaceOpen })
  return (
    <RawEditorSurface
      autocomplete={autocomplete}
      containerRef={containerRef}
      findOpen={findOpen}
      findRequest={findRequest}
      handleItemHover={handleItemHover}
      handleRemoteImagePaste={handleRemoteImagePaste}
      locale={locale}
      path={path}
      pendingChanges={pendingChanges}
      rawDoc={rawDoc}
      replaceOpen={replaceOpen}
      rootRef={rootRef}
      setFindOpen={setFindOpen}
      setReplaceOpen={setReplaceOpen}
      showFrontmatterWarning={showFrontmatterWarning}
      viewRef={viewRef}
    />
  )
}
