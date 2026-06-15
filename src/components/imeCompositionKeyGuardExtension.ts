import { createExtension } from '@blocknote/core'

interface ComposingEditorView {
  composing?: boolean
}

const COMPOSITION_SETTLE_WINDOW_MS = 500

function isComposingKeyEvent(event: KeyboardEvent, view?: ComposingEditorView | null): boolean {
  return event.isComposing || event.keyCode === 229 || Boolean(view?.composing)
}

function isEnterKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    || event.code === 'Enter'
    || event.code === 'NumpadEnter'
    || event.keyCode === 13
}

export function shouldStopComposingEnterKey(
  event: KeyboardEvent,
  view?: ComposingEditorView | null,
): boolean {
  return isEnterKey(event) && isComposingKeyEvent(event, view)
}

export function shouldStopComposingParagraphInput(
  event: InputEvent,
  view?: ComposingEditorView | null,
  compositionEndedAt = Number.NEGATIVE_INFINITY,
): boolean {
  return (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak')
    && (
      event.isComposing
      || Boolean(view?.composing)
      || Math.abs(event.timeStamp - compositionEndedAt) < COMPOSITION_SETTLE_WINDOW_MS
    )
}

export const createImeCompositionKeyGuardExtension = createExtension(({ editor }) => {
  const readView = () => editor._tiptapEditor?.view ?? editor.prosemirrorView
  let compositionEndedAt = Number.NEGATIVE_INFINITY

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!shouldStopComposingEnterKey(event, readView())) return

    event.stopImmediatePropagation()
  }

  const handleCompositionEnd = (event: CompositionEvent) => {
    compositionEndedAt = event.timeStamp
  }

  const handleBeforeInput = (event: InputEvent) => {
    if (!shouldStopComposingParagraphInput(event, readView(), compositionEndedAt)) return

    compositionEndedAt = Number.NEGATIVE_INFINITY
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  return {
    key: 'imeCompositionKeyGuard',
    mount: ({ dom, signal }) => {
      dom.addEventListener('keydown', handleKeyDown, {
        capture: true,
        signal,
      })
      dom.addEventListener('compositionend', handleCompositionEnd, {
        capture: true,
        signal,
      })
      dom.addEventListener('beforeinput', handleBeforeInput as EventListener, {
        capture: true,
        signal,
      })
    },
  } as const
})
