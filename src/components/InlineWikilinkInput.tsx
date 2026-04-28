import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { VaultEntry } from '../types'
import type { NoteReference } from '../utils/ai-context'
import { buildTypeEntryMap } from '../utils/typeColors'
import {
  deleteInlineSelection,
  replaceInlineSelection,
  selectedInlineText,
} from './inlineWikilinkEdits'
import {
  buildInlineWikilinkSegments,
  extractInlineWikilinkReferences,
  findActiveWikilinkQuery,
} from './inlineWikilinkText'
import { extractDroppedPathText, formatDroppedPathList } from './inlineWikilinkDropText'
import {
  readSelectionRange,
  serializeInlineNode,
  type InlineSelectionRange,
} from './inlineWikilinkDom'
import {
  buildPendingPasteState,
  type PendingPasteState,
  shouldRecoverPendingPaste,
} from './inlineWikilinkPasteRecovery'
import {
  InlineWikilinkEditorField,
  InlineWikilinkPaletteLayout,
  InlineWikilinkSuggestionList,
} from './InlineWikilinkParts'
import { handleInlineWikilinkKeyDown } from './inlineWikilinkKeydown'
import { useInlineWikilinkSelection } from './useInlineWikilinkSelection'
import { useInlineWikilinkSuggestionsState } from './useInlineWikilinkSuggestionsState'
import { normalizeInlineWikilinkValue } from './inlineWikilinkTokens'
import {
  isInsertBeforeInput,
  isPlainTextBeforeInput,
} from './inlineWikilinkBeforeInput'
import { useNativePathDrop } from './useNativePathDrop'

interface InlineWikilinkInputProps {
  entries: VaultEntry[]
  value: string
  onChange: (value: string) => void
  onSubmit?: (text: string, references: NoteReference[]) => void
  onUnsupportedPaste?: (message: string) => void
  submitOnEmpty?: boolean
  disabled?: boolean
  placeholder?: string
  inputRef?: React.RefObject<HTMLDivElement | null>
  dataTestId?: string
  editorClassName?: string
  suggestionListVariant?: 'floating' | 'palette'
  suggestionEmptyLabel?: string
  paletteHeader?: ReactNode
  paletteEmptyState?: ReactNode
  paletteFooter?: ReactNode
}

function collapseSelectionRange(nextSelectionIndex: number) {
  return {
    start: nextSelectionIndex,
    end: nextSelectionIndex,
  }
}

function fullSelectionRange(value: string) {
  return {
    start: 0,
    end: value.length,
  }
}

function isSelectAllShortcut(event: React.KeyboardEvent<HTMLDivElement>) {
  return event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey)
}

function isLineBreakShortcut(
  event: React.KeyboardEvent<HTMLDivElement>,
  isComposing: boolean,
) {
  return event.key === 'Enter'
    && event.shiftKey
    && !isComposing
    && !event.nativeEvent.isComposing
    && event.keyCode !== 229
}

export const UNSUPPORTED_INLINE_PASTE_MESSAGE = 'Only text paste is supported in the AI composer right now.'

function hasUnsupportedClipboardPayload(clipboardData: DataTransfer) {
  if (clipboardData.files.length > 0) return true

  return Array.from(clipboardData.items).some((item) =>
    item.kind === 'file' || item.type.startsWith('image/'),
  )
}

function containsUnsupportedInlineContent(editor: HTMLDivElement) {
  return editor.querySelector('img, picture, video, audio, canvas, figure, iframe, object') !== null
}

function submitInlineValue({
  onSubmit,
  submitOnEmpty,
  value,
  references,
}: {
  onSubmit?: (text: string, references: NoteReference[]) => void
  submitOnEmpty: boolean
  value: string
  references: NoteReference[]
}) {
  if (!onSubmit) return
  const normalizedValue = normalizeInlineWikilinkValue(value)
  if (!submitOnEmpty && !normalizedValue.trim()) return
  onSubmit(normalizedValue, references)
}

function renderInlineSuggestionList({
  suggestions,
  selectedSuggestionIndex,
  setSuggestionIndex,
  selectSuggestion,
  typeEntryMap,
  suggestionListVariant,
  suggestionEmptyLabel,
}: {
  suggestions: ReturnType<typeof useInlineWikilinkSuggestionsState>['suggestions']
  selectedSuggestionIndex: number
  setSuggestionIndex: (index: number) => void
  selectSuggestion: (index: number) => void
  typeEntryMap: Record<string, VaultEntry>
  suggestionListVariant: 'floating' | 'palette'
  suggestionEmptyLabel: string
}) {
  if (suggestions.length === 0) return null

  return (
    <InlineWikilinkSuggestionList
      suggestions={suggestions}
      selectedIndex={selectedSuggestionIndex}
      onHover={setSuggestionIndex}
      onSelect={selectSuggestion}
      typeEntryMap={typeEntryMap}
      variant={suggestionListVariant}
      emptyLabel={suggestionEmptyLabel}
    />
  )
}

export function InlineWikilinkInput({
  entries,
  value,
  onChange,
  onSubmit,
  onUnsupportedPaste,
  submitOnEmpty = false,
  disabled = false,
  placeholder,
  inputRef,
  dataTestId = 'agent-input',
  editorClassName,
  suggestionListVariant = 'floating',
  suggestionEmptyLabel = 'No matching notes',
  paletteHeader,
  paletteEmptyState,
  paletteFooter,
}: InlineWikilinkInputProps) {
  const [renderVersion, forceRender] = useState(0)
  const isComposingRef = useRef(false)
  const segments = useMemo(
    () => buildInlineWikilinkSegments(value, entries),
    [entries, value],
  )
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const {
    editorRef,
    selectionRange,
    selectionIndex,
    setSelectionRange,
    setCombinedRef,
    syncSelectionRange,
    commitValueFromEditor,
    focusSelectionRange,
  } = useInlineWikilinkSelection({
    value,
    onChange,
    inputRef,
    isComposingRef,
  })
  const pendingPasteRef = useRef<PendingPasteState | null>(null)
  const pendingCompositionInputRef = useRef(false)
  const handledFileDropRef = useRef(false)
  const pendingFocusAfterRemountRef = useRef<InlineSelectionRange | null>(null)
  useLayoutEffect(() => {
    const target = pendingFocusAfterRemountRef.current
    if (!target) return
    pendingFocusAfterRemountRef.current = null
    focusSelectionRange(target)
  }, [focusSelectionRange, renderVersion])
  const activeQuery = useMemo(
    () => selectionRange.start === selectionRange.end
      ? findActiveWikilinkQuery(value, selectionIndex)
      : null,
    [selectionIndex, selectionRange.end, selectionRange.start, value],
  )
  const references = useMemo(() => extractInlineWikilinkReferences(value, entries), [entries, value])
  const {
    suggestions,
    selectedSuggestionIndex,
    setSuggestionIndex,
    selectSuggestion,
    cycleSuggestions,
  } = useInlineWikilinkSuggestionsState({
    activeQueryKey: activeQuery ? `${activeQuery.start}:${activeQuery.query}` : '',
    entries,
    query: activeQuery?.query ?? null,
    value,
    selectionIndex,
    onChange,
    onSelectionIndexChange: (nextSelectionIndex) => setSelectionRange(collapseSelectionRange(nextSelectionIndex)),
    focusSelectionAt: (nextSelectionIndex) => focusSelectionRange(collapseSelectionRange(nextSelectionIndex)),
  })
  const insertTransferText = useCallback((text: string, focusAfterInsert = false) => {
    const editor = editorRef.current
    const currentSelectionRange = editor && !focusAfterInsert
      ? readSelectionRange(editor)
      : selectionRange
    const nextState = replaceInlineSelection(value, currentSelectionRange, text)
    const shouldRestoreFocus = focusAfterInsert || document.activeElement === editor

    onChange(nextState.value)
    setSelectionRange(nextState.selection)
    pendingFocusAfterRemountRef.current = shouldRestoreFocus ? nextState.selection : null
    forceRender((current) => current + 1)
  }, [editorRef, onChange, selectionRange, setSelectionRange, value])
  const insertNativePathDrop = (paths: string[]) => {
    const droppedPathText = formatDroppedPathList(paths)
    if (!droppedPathText) return

    insertTransferText(droppedPathText, true)
  }
  useNativePathDrop({
    targetRef: editorRef,
    disabled,
    onPathDrop: insertNativePathDrop,
  })
  const notifyUnsupportedPaste = useCallback(
    () => onUnsupportedPaste?.(UNSUPPORTED_INLINE_PASTE_MESSAGE),
    [onUnsupportedPaste],
  )
  const recoverUnsupportedMutation = () => {
    pendingCompositionInputRef.current = false
    pendingPasteRef.current = null
    notifyUnsupportedPaste()
    forceRender((current) => current + 1)
    setSelectionRange({ ...selectionRange })
  }
  const deleteContent = (direction: 'backward' | 'forward') => {
    const nextState = deleteInlineSelection(value, selectionRange, segments, direction)
    if (!nextState) return
    onChange(nextState.value)
    setSelectionRange(nextState.selection)
  }
  const selectAllContent = () => {
    const nextSelection = fullSelectionRange(value)
    setSelectionRange(nextSelection)
    focusSelectionRange(nextSelection)
  }
  const cutSelectedContent = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return

    const editor = editorRef.current
    const currentSelectionRange = editor ? readSelectionRange(editor) : selectionRange
    const selectedText = selectedInlineText(value, currentSelectionRange)
    if (!selectedText) return

    event.preventDefault()
    event.clipboardData.setData('text/plain', normalizeInlineWikilinkValue(selectedText))

    const nextState = deleteInlineSelection(value, currentSelectionRange, segments, 'backward')
    if (!nextState) return

    onChange(nextState.value)
    setSelectionRange(nextState.selection)
    pendingFocusAfterRemountRef.current = nextState.selection
    forceRender((current) => current + 1)
  }
  const handleBeforeInput = useCallback((nativeEvent: InputEvent) => {
    if (disabled) return

    if (!isInsertBeforeInput(nativeEvent)) return

    if (nativeEvent.inputType === 'insertLineBreak') {
      nativeEvent.preventDefault()
      insertTransferText('\n')
      return
    }

    if (isPlainTextBeforeInput(nativeEvent)) {
      nativeEvent.preventDefault()
      insertTransferText(nativeEvent.data)
      return
    }

    const dataTransfer = nativeEvent.dataTransfer
    if (!dataTransfer || !hasUnsupportedClipboardPayload(dataTransfer)) return

    if (nativeEvent.inputType === 'insertFromDrop' && handledFileDropRef.current) {
      handledFileDropRef.current = false
      nativeEvent.preventDefault()
      return
    }

    if (nativeEvent.inputType === 'insertFromDrop') {
      const droppedPathText = extractDroppedPathText(dataTransfer)
      if (droppedPathText) {
        nativeEvent.preventDefault()
        insertTransferText(droppedPathText)
        return
      }
    }

    nativeEvent.preventDefault()
    notifyUnsupportedPaste()
  }, [disabled, insertTransferText, notifyUnsupportedPaste])
  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    editor.addEventListener('beforeinput', handleBeforeInput as EventListener)
    return () => editor.removeEventListener('beforeinput', handleBeforeInput as EventListener)
  }, [editorRef, handleBeforeInput, renderVersion])
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return
    if (!hasUnsupportedClipboardPayload(event.dataTransfer)) return

    handledFileDropRef.current = true
    const droppedPathText = extractDroppedPathText(event.dataTransfer)
    event.preventDefault()

    if (!droppedPathText) {
      notifyUnsupportedPaste()
      return
    }

    insertTransferText(droppedPathText)
  }
  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return

    if (hasUnsupportedClipboardPayload(event.clipboardData)) {
      event.preventDefault()
      notifyUnsupportedPaste()
      return
    }

    const pastedText = normalizeInlineWikilinkValue(event.clipboardData.getData('text/plain'))
    if (!pastedText) return

    const nextState = replaceInlineSelection(value, selectionRange, pastedText)
    pendingPasteRef.current = buildPendingPasteState(value, selectionRange, pastedText)

    event.preventDefault()
    onChange(nextState.value)
    setSelectionRange(nextState.selection)
  }
  const syncValueFromEditor = () => {
    const editor = editorRef.current
    if (editor && containsUnsupportedInlineContent(editor)) {
      recoverUnsupportedMutation()
      return
    }

    const pendingPaste = pendingPasteRef.current
    if (editor && pendingPaste) {
      const nextValue = normalizeInlineWikilinkValue(serializeInlineNode(editor))
      pendingPasteRef.current = null

      if (shouldRecoverPendingPaste(nextValue, pendingPaste)) {
        onChange(pendingPaste.expectedValue)
        forceRender((current) => current + 1)
        setSelectionRange({ ...pendingPaste.expectedSelection })
        return
      }
    }

    commitValueFromEditor()
  }
  const flushPendingCompositionInput = () => {
    if (isComposingRef.current || !pendingCompositionInputRef.current) return
    pendingCompositionInputRef.current = false

    const editor = editorRef.current
    if (!editor) return

    if (containsUnsupportedInlineContent(editor)) {
      recoverUnsupportedMutation()
      return
    }

    const nextValue = normalizeInlineWikilinkValue(serializeInlineNode(editor))
    const nextSelection = readSelectionRange(editor)
    const clampedSelection: InlineSelectionRange = {
      start: Math.min(nextSelection.start, nextValue.length),
      end: Math.min(nextSelection.end, nextValue.length),
    }

    const shouldRestoreFocus = document.activeElement === editor
    pendingFocusAfterRemountRef.current = shouldRestoreFocus ? clampedSelection : null
    onChange(nextValue)
    setSelectionRange(clampedSelection)
    forceRender((current) => current + 1)
  }
  const handleCompositionStart = () => {
    isComposingRef.current = true
  }
  const handleCompositionEnd = () => {
    isComposingRef.current = false
    queueMicrotask(flushPendingCompositionInput)
  }
  const handleInput = () => {
    if (isComposingRef.current) {
      pendingCompositionInputRef.current = true
      return
    }

    pendingCompositionInputRef.current = false
    syncValueFromEditor()
  }
  const submitValue = () =>
    submitInlineValue({ onSubmit, submitOnEmpty, value, references })
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!disabled && isLineBreakShortcut(event, isComposingRef.current)) {
      event.preventDefault()
      insertTransferText('\n')
      return
    }

    if (isSelectAllShortcut(event)) {
      event.preventDefault()
      selectAllContent()
      return
    }

    handleInlineWikilinkKeyDown({
      event,
      disabled,
      isComposing: isComposingRef.current,
      suggestionsOpen: suggestions.length > 0,
      onCycleSuggestions: cycleSuggestions,
      onSelectSuggestion: () => selectSuggestion(selectedSuggestionIndex),
      onDeleteContent: deleteContent,
      canSubmit: onSubmit !== undefined,
      onSubmit: submitValue,
    })
  }
  const editor = (
    <InlineWikilinkEditorField
      key={renderVersion}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      inputRef={setCombinedRef}
      dataTestId={dataTestId}
      editorClassName={editorClassName}
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onCut={cutSelectedContent}
      onDrop={handleDrop}
      onPaste={handlePaste}
      onSelectionChange={syncSelectionRange}
      segments={segments}
      typeEntryMap={typeEntryMap}
    />
  )
  const suggestionList = renderInlineSuggestionList({
    suggestions,
    selectedSuggestionIndex,
    setSuggestionIndex,
    selectSuggestion,
    typeEntryMap,
    suggestionListVariant,
    suggestionEmptyLabel,
  })
  if (suggestionListVariant === 'palette') {
    return (
      <InlineWikilinkPaletteLayout
        header={paletteHeader}
        editor={editor}
        suggestionList={suggestionList}
        emptyState={paletteEmptyState}
        footer={paletteFooter}
      />
    )
  }
  return <div className="relative">{editor}{suggestionList}</div>
}
