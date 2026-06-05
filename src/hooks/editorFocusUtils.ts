const ROOT_EDITABLE_SELECTOR = '.ProseMirror[contenteditable="true"]'
const FALLBACK_EDITABLE_SELECTOR = '.bn-editor [contenteditable="true"]'
const MAX_FOCUS_ATTEMPTS = 12
const MAX_TITLE_SELECTION_ATTEMPTS = 12

interface HeadingRange {
  from: number
  to: number
}

interface FocusableHeadingBlock {
  id?: unknown
  type?: string
  props?: { level?: number } & Record<string, unknown>
  content?: unknown
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

function buildHeadingRange(pos: number, nodeSize: number): HeadingRange | null {
  const range = { from: pos + 1, to: pos + nodeSize - 1 }
  return range.from <= range.to ? range : null
}

function findFirstHeadingRange(tiptap: TiptapEditor): HeadingRange | null {
  let range: HeadingRange | null = null

  tiptap.state.doc.descendants((node, pos) => {
    if (range) return false
    if (node.type.name !== 'heading') return

    range = buildHeadingRange(pos, node.nodeSize)
    return false
  })

  return range
}

function isTopLevelHeadingBlock(block: FocusableHeadingBlock): boolean {
  return block.type === 'heading' && (block.props?.level === undefined || block.props?.level === 1)
}

function getHeadingBlockText(block: FocusableHeadingBlock | undefined): string {
  if (!Array.isArray(block?.content)) return ''

  return block.content
    .filter((item): item is { type?: string; text?: string } => (
      typeof item === 'object' && item !== null
    ))
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('')
    .trim()
}

function getFirstHeadingBlock(editor: FocusableEditor): FocusableHeadingBlock | undefined {
  return editor.document?.find(isTopLevelHeadingBlock)
}

function usableBlockId(block: FocusableHeadingBlock): string | null {
  return typeof block.id === 'string' && block.id.trim().length > 0
    ? block.id
    : null
}

function trySelectEmptyFirstHeading(editor: FocusableEditor): boolean {
  const firstHeadingBlock = getFirstHeadingBlock(editor)
  if (!firstHeadingBlock || !editor.setTextCursorPosition) return false
  if (getHeadingBlockText(firstHeadingBlock)) return false

  const headingBlockId = usableBlockId(firstHeadingBlock)
  if (!headingBlockId) return false

  editor.setTextCursorPosition(headingBlockId, 'start')
  return true
}

function trySelectFirstHeading(editor: FocusableEditor): boolean {
  if (trySelectEmptyFirstHeading(editor)) return true
  const tiptap = editor._tiptapEditor
  if (!tiptap?.state?.doc) return false

  const range = findFirstHeadingRange(tiptap)
  if (!range) return false

  tiptap.chain().setTextSelection(range).run()
  return true
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
