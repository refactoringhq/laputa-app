import type { EditorView } from '@tiptap/pm/view'

export type RichEditorView = EditorView

export type RichEditorViewOwner = {
  _tiptapEditor?: { view: RichEditorView }
  prosemirrorView?: RichEditorView
}

type KeyboardMountContext = {
  dom: HTMLElement
  signal: AbortSignal
}

type ComposingKeyboardEvent = Pick<KeyboardEvent, 'isComposing' | 'keyCode'>

export type ComposingEditorView = {
  composing?: boolean
}

type ConsumableKeyboardEvent = Pick<KeyboardEvent, 'preventDefault'> & Partial<
  Pick<KeyboardEvent, 'stopImmediatePropagation' | 'stopPropagation'>
>

export function activeRichEditorView(editor: RichEditorViewOwner): RichEditorView | undefined {
  return editor._tiptapEditor?.view ?? editor.prosemirrorView
}

export function isComposingKeyboardEvent(
  event: ComposingKeyboardEvent,
  view?: ComposingEditorView | null,
): boolean {
  return event.isComposing || event.keyCode === 229 || Boolean(view?.composing)
}

export function consumeKeyboardEvent(
  event: ConsumableKeyboardEvent,
  propagation: 'bubble' | 'immediate' = 'immediate',
): void {
  event.preventDefault()
  if (propagation === 'bubble') {
    event.stopPropagation?.()
    return
  }
  event.stopImmediatePropagation?.()
}

export function createCaptureKeydownMount(
  editor: RichEditorViewOwner,
  handleKeyDown: (event: KeyboardEvent, view?: RichEditorView) => void,
): (context: KeyboardMountContext) => void {
  return ({ dom, signal }) => {
    dom.addEventListener('keydown', (event) => {
      handleKeyDown(event, activeRichEditorView(editor))
    }, { capture: true, signal })
  }
}
