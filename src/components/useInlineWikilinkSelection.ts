import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  applySelectionRange,
  readSelectionRange,
  serializeInlineNode,
  type InlineSelectionRange,
} from './inlineWikilinkDom'
import { normalizeInlineWikilinkValue } from './inlineWikilinkTokens'

interface UseInlineWikilinkSelectionArgs {
  value: string
  onChange: (value: string) => void
  inputRef?: React.RefObject<HTMLDivElement | null>
  isComposingRef?: React.RefObject<boolean>
}

function getSelectionSyncEditor(
  editor: HTMLDivElement | null,
  isComposingRef?: React.RefObject<boolean>,
) {
  if (!editor || isComposingRef?.current === true) return null
  return editor
}

function getActiveSelectionEditor(
  editor: HTMLDivElement | null,
  isComposingRef?: React.RefObject<boolean>,
) {
  if (!editor) return null
  if (document.activeElement !== editor) return null
  if (isComposingRef?.current === true) return null

  return editor
}

export function useInlineWikilinkSelection({
  value,
  onChange,
  inputRef,
  isComposingRef,
}: UseInlineWikilinkSelectionArgs) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [selectionRange, setSelectionRange] = useState<InlineSelectionRange>({
    start: value.length,
    end: value.length,
  })

  const setCombinedRef = useCallback((node: HTMLDivElement | null) => {
    editorRef.current = node
    if (inputRef) {
      inputRef.current = node
    }
  }, [inputRef])

  const syncSelectionRange = useCallback(() => {
    const editor = getSelectionSyncEditor(editorRef.current, isComposingRef)
    if (!editor) return
    setSelectionRange(readSelectionRange(editor))
  }, [isComposingRef])

  const focusSelectionRange = useCallback((nextSelectionRange: InlineSelectionRange) => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    applySelectionRange(editor, nextSelectionRange)
  }, [])

  const commitValueFromEditor = useCallback(() => {
    if (!editorRef.current) return

    const nextValue = normalizeInlineWikilinkValue(serializeInlineNode(editorRef.current))
    const nextSelectionRange = readSelectionRange(editorRef.current)

    onChange(nextValue)
    setSelectionRange({
      start: Math.min(nextSelectionRange.start, nextValue.length),
      end: Math.min(nextSelectionRange.end, nextValue.length),
    })
  }, [onChange])

  useLayoutEffect(() => {
    void value
    const editor = getActiveSelectionEditor(editorRef.current, isComposingRef)
    if (!editor) return
    applySelectionRange(editor, selectionRange)
  }, [isComposingRef, selectionRange, value])

  return {
    editorRef,
    selectionRange,
    selectionIndex: selectionRange.end,
    setSelectionRange,
    setCombinedRef,
    syncSelectionRange,
    focusSelectionRange,
    commitValueFromEditor,
  }
}
