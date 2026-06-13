import { trySelectFirstHeading } from './editorTitleSelection'
import type { TitleHeadingTextBlock } from './editorTitleHeadingText'

const ROOT_EDITABLE_SELECTOR = '.ProseMirror[contenteditable="true"]'
const FALLBACK_EDITABLE_SELECTOR = '.bn-editor [contenteditable="true"]'
const MAX_FOCUS_ATTEMPTS = 12
const MAX_TITLE_SELECTION_ATTEMPTS = 12

interface FocusableHeadingBlock extends TitleHeadingTextBlock {
  id?: unknown
  type?: string
  props?: { level?: number } & Record<string, unknown>
}

interface TiptapChain {
  setTextSelection: (pos: { from: number; to: number }) => TiptapChain
  run: () => void
}

export interface TiptapEditor {
  state: { doc: { descendants: (cb: (node: { type: { name: string }; nodeSize: number }, pos: number) => boolean | void) => void } }
  chain: () => TiptapChain
}

export interface FocusableEditor {
  focus: () => void
  _tiptapEditor?: TiptapEditor
  document?: FocusableHeadingBlock[]
  setTextCursorPosition?: (targetBlock: string, placement?: 'start' | 'end') => void
}

function hasEditableFocus(): boolean {
  const activeElement = document.activeElement
  return activeElement instanceof Element
    && (Reflect.get(activeElement, 'isContentEditable') === true || activeElement.closest('[contenteditable="true"]') !== null)
}

function canFocusWindow(): boolean {
  return !navigator.userAgent.toLowerCase().includes('jsdom')
}

function focusEditableCandidate(editable: HTMLElement): boolean {
  if (canFocusWindow()) {
    window.focus?.()
  }
  editable.focus()

  if (hasEditableFocus()) return true

  const selection = window.getSelection()
  if (selection && editable.isContentEditable) {
    const range = document.createRange()
    range.selectNodeContents(editable)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    editable.focus()
  }

  return hasEditableFocus()
}

function focusEditableNode(): boolean {
  const rootEditable = document.querySelector<HTMLElement>(ROOT_EDITABLE_SELECTOR)
  if (rootEditable && focusEditableCandidate(rootEditable)) {
    return true
  }

  const fallbackEditable = document.querySelector<HTMLElement>(FALLBACK_EDITABLE_SELECTOR)
  if (fallbackEditable && focusEditableCandidate(fallbackEditable)) {
    return true
  }

  return false
}

function ensureEditableFocus(): boolean {
  if (hasEditableFocus()) return true
  focusEditableNode()
  return hasEditableFocus()
}

function logFocusTiming(t0: number | undefined, label: 'focus' | 'focus+select'): void {
  if (!t0) return
  console.debug(`[perf] createNote → ${label}: ${(performance.now() - t0).toFixed(1)}ms`)
}

function selectTitleWithRetries(
  editor: FocusableEditor,
  t0: number | undefined,
  attempt = 0,
): void {
  const selectedHeading = ensureEditableFocus() && trySelectFirstHeading(editor)

  if (selectedHeading || attempt >= MAX_TITLE_SELECTION_ATTEMPTS) {
    logFocusTiming(t0, 'focus+select')
    return
  }

  requestAnimationFrame(() => selectTitleWithRetries(editor, t0, attempt + 1))
}

export function focusEditorWithRetries(
  editor: FocusableEditor,
  selectTitle: boolean,
  t0: number | undefined,
  attempt = 0,
): void {
  editor.focus()
  const hasFocus = ensureEditableFocus()
  if (!hasFocus && attempt < MAX_FOCUS_ATTEMPTS) {
    requestAnimationFrame(() => focusEditorWithRetries(editor, selectTitle, t0, attempt + 1))
    return
  }
  if (!selectTitle) {
    logFocusTiming(t0, 'focus')
    return
  }
  // The first heading can arrive a frame or two later than the initial focus
  // on slower CI and native tab-swap paths, so keep retrying until it exists.
  requestAnimationFrame(() => selectTitleWithRetries(editor, t0))
}
