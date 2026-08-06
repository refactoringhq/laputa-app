import { createExtension } from '@blocknote/core'
import {
  activeRichEditorView,
  isComposingKeyboardEvent,
  type ComposingEditorView,
} from './richEditorKeyboard'

const COMPOSITION_SETTLE_WINDOW_MS = 500

function isEnterKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    || event.code === 'Enter'
    || event.code === 'NumpadEnter'
    || event.keyCode === 13
}

function isSpaceKey(event: KeyboardEvent): boolean {
  return event.key === ' '
    || event.code === 'Space'
    || event.keyCode === 32
}

function isCompositionEditorShortcutKey(event: KeyboardEvent): boolean {
  return isEnterKey(event) || isSpaceKey(event)
}

function isParagraphInput(event: InputEvent): boolean {
  return event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak'
}

export function shouldStopComposingEditorShortcutKey(
  event: KeyboardEvent,
  view?: ComposingEditorView | null,
): boolean {
  return isCompositionEditorShortcutKey(event) && isComposingKeyboardEvent(event, view)
}

export function shouldStopComposingParagraphInput(
  event: InputEvent,
  view?: ComposingEditorView | null,
  composingEnterAt: number | null = null,
): boolean {
  if (!isParagraphInput(event)) return false
  if (event.isComposing || view?.composing === true) return true
  if (composingEnterAt === null) return false

  const elapsed = event.timeStamp - composingEnterAt
  return elapsed >= 0 && elapsed < COMPOSITION_SETTLE_WINDOW_MS
}

export const createImeCompositionKeyGuardExtension = createExtension(({ editor }) => {
  const readView = () => activeRichEditorView(editor)
  let composingEnterAt: number | null = null

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!shouldStopComposingEditorShortcutKey(event, readView())) {
      composingEnterAt = null
      return
    }

    if (isEnterKey(event)) composingEnterAt = event.timeStamp
    event.stopImmediatePropagation()
  }

  const handleCompositionEnd = (event: CompositionEvent) => {
    if (composingEnterAt !== null) composingEnterAt = event.timeStamp
  }

  const handleBeforeInput = (event: InputEvent) => {
    if (!isParagraphInput(event)) return
    if (!shouldStopComposingParagraphInput(event, readView(), composingEnterAt)) {
      composingEnterAt = null
      return
    }

    composingEnterAt = null
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
