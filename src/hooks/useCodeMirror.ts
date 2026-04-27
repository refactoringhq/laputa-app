import { useRef, useEffect } from 'react'
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view'
import { EditorState, Prec } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { frontmatterHighlightPlugin, frontmatterHighlightTheme } from '../extensions/frontmatterHighlight'
import { markdownLanguage } from '../extensions/markdownHighlight'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
import { resolveArrowLigatureInput } from '../utils/arrowLigatures'
import { zoomCursorFix } from '../extensions/zoomCursorFix'
import { nativeTextAssistanceDisabledAttributes } from '../lib/nativeTextAssistance'

const FONT_FAMILY = '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
const RAW_EDITOR_COLORS = {
  activeLineBackground: 'var(--state-hover-subtle)',
  background: 'var(--surface-editor)',
  foreground: 'var(--text-primary)',
  gutterBackground: 'var(--surface-editor)',
  gutterBorder: 'var(--border-subtle)',
  gutterText: 'var(--text-muted)',
}
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
      paddingTop: '16px',
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
    '.cm-line': { padding: '0' },
  })
}

function buildSaveKeymap(callbacks: { current: CodeMirrorCallbacks }) {
  return Prec.highest(keymap.of([{
    key: 'Mod-s',
    run: () => { callbacks.current.onSave(); return true },
  }, {
    key: 'Escape',
    run: () => callbacks.current.onEscape(),
  }]))
}

function buildArrowLigaturesExtension() {
  let literalAsciiCursor: number | null = null

  return EditorView.inputHandler.of((view, from, _to, text) => {
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

export function useCodeMirror(
  containerRef: React.RefObject<HTMLDivElement | null>,
  content: string,
  callbacks: CodeMirrorCallbacks,
) {
  const viewRef = useRef<EditorView | null>(null)
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks
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
    const parent = containerRef.current
    if (!parent) return

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        history(),
        buildArrowLigaturesExtension(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        buildSaveKeymap(callbacksRef),
        buildBaseTheme(),
        EditorView.cspNonce.of(RUNTIME_STYLE_NONCE),
        EditorView.contentAttributes.of(nativeTextAssistanceDisabledAttributes),
        markdownLanguage(),
        frontmatterHighlightTheme(),
        frontmatterHighlightPlugin,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return viewRef
}
