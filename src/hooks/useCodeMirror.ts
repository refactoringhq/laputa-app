import { useRef, useEffect } from 'react'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  lineNumbers,
  highlightActiveLine,
  keymap,
  type KeyBinding,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { EditorSelection, EditorState, Prec, type SelectionRange } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, insertTab } from '@codemirror/commands'
import { rawEditorLanguageExtensionsForPath } from '../extensions/rawEditorLanguage'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
import { resolveArrowLigatureInput } from '../utils/arrowLigatures'
import { zoomCursorFix } from '../extensions/zoomCursorFix'
import { rawEditorTextInputAttributes } from '../lib/nativeTextAssistance'
import { isInsideMarkdownFence } from '../utils/markdownFences'
import { isWindows } from '../utils/platform'

const FONT_FAMILY = '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const RAW_EDITOR_COLORS = {
  activeLineBackground: 'var(--state-hover-subtle)',
  background: 'var(--surface-editor)',
  foreground: 'var(--text-primary)',
  gutterBackground: 'var(--surface-editor)',
  gutterBorder: 'var(--border-subtle)',
  gutterText: 'var(--text-muted)',
}

const AUTO_TEXT_DIRECTION_LINE = Decoration.line({
  attributes: { dir: 'auto' },
})
type LineBlock = ReturnType<EditorView['lineBlockAt']>

interface LineBoundaryDirection {
  assoc: -1 | 1
  edge: (line: LineBlock) => number
}

interface BoundarySelectionMode {
  extend: boolean
}

interface LineBoundaryContext {
  view: EditorView
  line: LineBlock
  range: SelectionRange
  direction: LineBoundaryDirection
}

const START_BOUNDARY: LineBoundaryDirection = {
  assoc: 1,
  edge: (line) => line.from,
}
const END_BOUNDARY: LineBoundaryDirection = {
  assoc: -1,
  edge: (line) => line.to,
}
const MOVE_SELECTION: BoundarySelectionMode = { extend: false }
const EXTEND_SELECTION: BoundarySelectionMode = { extend: true }

export interface CodeMirrorCallbacks {
  onDocChange: (doc: string) => void
  onCursorActivity: (view: EditorView) => void
  onSave: () => void
  onEscape: () => boolean
}

function buildBaseTheme() {
  return EditorView.theme({
    '&': {
      fontSize: '13px',
      fontFamily: FONT_FAMILY,
      backgroundColor: RAW_EDITOR_COLORS.background,
      color: RAW_EDITOR_COLORS.foreground,
      flex: '1',
      minHeight: '0',
    },
    '.cm-scroller': {
      fontFamily: FONT_FAMILY,
      lineHeight: '1.6',
      padding: '0',
      overflow: 'auto',
    },
    '.cm-content': {
      padding: '16px 32px 16px 12px',
      caretColor: RAW_EDITOR_COLORS.foreground,
    },
    '.cm-gutters': {
      backgroundColor: RAW_EDITOR_COLORS.gutterBackground,
      color: RAW_EDITOR_COLORS.gutterText,
      borderRight: `1px solid ${RAW_EDITOR_COLORS.gutterBorder}`,
      minHeight: '100%',
      paddingTop: '0',
      paddingLeft: '6px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      paddingRight: '12px',
      minWidth: '28px',
      textAlign: 'right',
    },
    '.cm-activeLine': {
      backgroundColor: RAW_EDITOR_COLORS.activeLineBackground,
    },
    '.cm-activeLineGutter': {
      backgroundColor: RAW_EDITOR_COLORS.activeLineBackground,
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-line': {
      padding: '0',
      unicodeBidi: 'plaintext',
      textAlign: 'start',
    },
  })
}

function buildAutoTextDirectionDecorations(view: EditorView): DecorationSet {
  const ranges = []

  for (const visibleRange of view.visibleRanges) {
    for (let pos = visibleRange.from; pos <= visibleRange.to;) {
      const line = view.state.doc.lineAt(pos)
      ranges.push(AUTO_TEXT_DIRECTION_LINE.range(line.from))
      pos = line.to + 1
    }
  }

  return Decoration.set(ranges, true)
}

function buildAutoTextDirectionExtension() {
  return [
    EditorView.perLineTextDirection.of(true),
    ViewPlugin.fromClass(class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildAutoTextDirectionDecorations(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildAutoTextDirectionDecorations(update.view)
        }
      }
    }, {
      decorations: plugin => plugin.decorations,
    }),
  ]
}

function buildSaveKeymap(callbacks: { current: CodeMirrorCallbacks }) {
  return Prec.highest(keymap.of([{
    key: 'Mod-s',
    run: () => { callbacks.current.onSave(); return true },
  }, {
    key: 'Escape',
    run: () => callbacks.current.onEscape(),
  }, {
    key: 'Tab',
    run: insertTab,
  }]))
}

function lineIndentBoundary({ view, line, head }: { view: EditorView; line: LineBlock; head: number }): number {
  const leadingWhitespace = /^\s*/u.exec(view.state.sliceDoc(line.from, Math.min(line.from + 100, line.to)))?.[0].length ?? 0
  const indentationEnd = line.from + leadingWhitespace
  return leadingWhitespace > 0 && head !== indentationEnd ? indentationEnd : line.from
}

function logicalLineBoundary({ view, line, range, direction }: LineBoundaryContext): number {
  return direction === END_BOUNDARY
    ? line.to
    : lineIndentBoundary({ view, line, head: range.head })
}

function middleY(rect: { top: number; bottom: number }): number {
  return (rect.top + rect.bottom) / 2
}

function staysOnVisualRow(view: EditorView, from: number, to: number): boolean {
  const startCoords = view.coordsAtPos(from)
  const targetCoords = view.coordsAtPos(to)
  if (!startCoords || !targetCoords) return true

  const tolerance = Math.max(2, view.defaultLineHeight * 0.75)
  return Math.abs(middleY(startCoords) - middleY(targetCoords)) <= tolerance
}

function shouldRetryLogicalBoundary(
  context: LineBoundaryContext & { movedHead: number },
): boolean {
  return context.movedHead === context.range.head && context.movedHead !== context.direction.edge(context.line)
}

function readCodeMirrorLineBoundary(context: LineBoundaryContext): number {
  const forward = context.direction === END_BOUNDARY
  const moved = context.view.moveToLineBoundary(context.range, forward)
  if (shouldRetryLogicalBoundary({ ...context, movedHead: moved.head })) {
    return context.view.moveToLineBoundary(context.range, forward, false).head
  }
  return moved.head
}

function isSafeLineBoundary({ view, line, from, to }: { view: EditorView; line: LineBlock; from: number; to: number }): boolean {
  if (to < line.from || to > line.to) return false
  return staysOnVisualRow(view, from, to)
}

function normalizeBackwardBoundary(
  context: LineBoundaryContext & { boundary: number },
): number {
  if (context.direction === END_BOUNDARY) return context.boundary
  return context.boundary === context.line.from && context.line.length
    ? lineIndentBoundary({ view: context.view, line: context.line, head: context.range.head })
    : context.boundary
}

function readSafeLineBoundary(view: EditorView, range: SelectionRange, direction: LineBoundaryDirection): number {
  const line = view.lineBlockAt(range.head)
  const context = { view, line, range, direction }
  const boundary = readCodeMirrorLineBoundary(context)
  if (!isSafeLineBoundary({ view, line, from: range.head, to: boundary })) {
    return logicalLineBoundary(context)
  }
  return normalizeBackwardBoundary({ ...context, boundary })
}

function moveWindowsLineBoundary(
  view: EditorView,
  direction: LineBoundaryDirection,
  selectionMode: BoundarySelectionMode,
): boolean {
  const selection = EditorSelection.create(
    view.state.selection.ranges.map((range) => {
      const boundary = readSafeLineBoundary(view, range, direction)
      return selectionMode.extend
        ? EditorSelection.range(range.anchor, boundary)
        : EditorSelection.cursor(boundary, direction.assoc)
    }),
    view.state.selection.mainIndex,
  )

  if (!selection.eq(view.state.selection, true)) {
    view.dispatch({
      selection,
      scrollIntoView: true,
      userEvent: 'select',
    })
  }
  return true
}

function windowsLineBoundaryKeymap(): KeyBinding[] {
  if (!isWindows()) return []
  return [{
    key: 'Home',
    run: (view) => moveWindowsLineBoundary(view, START_BOUNDARY, MOVE_SELECTION),
    shift: (view) => moveWindowsLineBoundary(view, START_BOUNDARY, EXTEND_SELECTION),
    preventDefault: true,
  }, {
    key: 'End',
    run: (view) => moveWindowsLineBoundary(view, END_BOUNDARY, MOVE_SELECTION),
    shift: (view) => moveWindowsLineBoundary(view, END_BOUNDARY, EXTEND_SELECTION),
    preventDefault: true,
  }]
}

function buildRawEditorKeymap() {
  const defaultBindings = isWindows()
    ? defaultKeymap.filter((binding) => binding.key !== 'Home' && binding.key !== 'End')
    : defaultKeymap

  return keymap.of([
    ...windowsLineBoundaryKeymap(),
    ...defaultBindings,
    ...historyKeymap,
  ])
}

function buildArrowLigaturesExtension() {
  let literalAsciiCursor: number | null = null

  return EditorView.inputHandler.of((view, from, _to, text) => {
    if (isInsideMarkdownFence(view.state.doc.sliceString(0, from))) {
      literalAsciiCursor = null
      return false
    }

    const beforeText = view.state.doc.sliceString(Math.max(0, from - 2), from)
    const resolution = resolveArrowLigatureInput({
      beforeText,
      cursor: from,
      inputText: text,
      literalAsciiCursor,
    })
    literalAsciiCursor = resolution.nextLiteralAsciiCursor

    if (!resolution.change) {
      return false
    }

    view.dispatch({
      changes: {
        from: resolution.change.from,
        to: resolution.change.to,
        insert: resolution.change.insert,
      },
      selection: {
        anchor: resolution.change.from + resolution.change.insert.length,
      },
      userEvent: 'input.type',
    })
    return true
  })
}

function readRefCurrent<T>(ref: React.RefObject<T>): T | null {
  return ref.current
}

export function useCodeMirror(
  containerRef: React.RefObject<HTMLElement | null>,
  content: string,
  callbacks: CodeMirrorCallbacks,
  sourcePath?: string | null,
) {
  const viewRef = useRef<EditorView | null>(null)
  const callbacksRef = useRef(callbacks)
  const initialContentRef = useRef(content)
  useEffect(() => {
    callbacksRef.current = callbacks
  }, [callbacks])
  // Track whether we're dispatching an external sync so the updateListener skips it
  const externalSyncRef = useRef(false)

  // Sync content prop changes to the editor (e.g. after frontmatter update on disk)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === content) return
    externalSyncRef.current = true
    view.dispatch({ changes: { from: 0, to: current.length, insert: content } })
    externalSyncRef.current = false
  }, [content])

  useEffect(() => {
    const parent = readRefCurrent(containerRef)
    if (!parent) return

    const state = EditorState.create({
      doc: initialContentRef.current,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        buildAutoTextDirectionExtension(),
        history(),
        buildArrowLigaturesExtension(),
        buildRawEditorKeymap(),
        buildSaveKeymap(callbacksRef),
        buildBaseTheme(),
        EditorView.cspNonce.of(RUNTIME_STYLE_NONCE),
        EditorView.contentAttributes.of(rawEditorTextInputAttributes),
        rawEditorLanguageExtensionsForPath(sourcePath),
        zoomCursorFix(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalSyncRef.current) {
            callbacksRef.current.onDocChange(update.state.doc.toString())
          }
          if (update.selectionSet || update.docChanged) {
            callbacksRef.current.onCursorActivity(update.view)
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent })
    viewRef.current = view
    // Expose EditorView on the parent DOM for Playwright test access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(parent as any).__cmView = view

    // When CSS zoom changes on the document, CodeMirror's cached measurements
    // (scaleX/scaleY, line heights, character widths) become stale because
    // ResizeObserver doesn't fire for ancestor zoom changes. Force a re-measure
    // so cursor placement stays accurate at any zoom level.
    const handleZoomChange = () => { view.requestMeasure() }
    window.addEventListener('laputa-zoom-change', handleZoomChange)

    return () => {
      window.removeEventListener('laputa-zoom-change', handleZoomChange)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (parent as any).__cmView
      view.destroy()
      viewRef.current = null
    }
  }, [containerRef, sourcePath])

  return viewRef
}
