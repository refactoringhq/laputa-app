import { createExtension } from '@blocknote/core'

interface ComposingEditorView {
  composing?: boolean
}

function isComposingKeyEvent(event: KeyboardEvent, view?: ComposingEditorView | null): boolean {
  return event.isComposing || event.keyCode === 229 || Boolean(view?.composing)
}

function isEnterKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter'
    || event.code === 'Enter'
    || event.code === 'NumpadEnter'
    || event.keyCode === 13
}

function isSpaceKey(event: KeyboardEvent): boolean {
  return event.key === ' '
    || event.key === 'Spacebar'
    || event.code === 'Space'
    || event.keyCode === 32
}

export function shouldStopComposingCommitKey(
  event: KeyboardEvent,
  view?: ComposingEditorView | null,
): boolean {
  return (isEnterKey(event) || isSpaceKey(event)) && isComposingKeyEvent(event, view)
}

export const createImeCompositionKeyGuardExtension = createExtension(({ editor }) => {
  const readView = () => editor._tiptapEditor?.view ?? editor.prosemirrorView

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!shouldStopComposingCommitKey(event, readView())) return

    event.stopImmediatePropagation()
  }

  return {
    key: 'imeCompositionKeyGuard',
    mount: ({ dom, signal }) => {
      dom.addEventListener('keydown', handleKeyDown, {
        capture: true,
        signal,
      })
    },
  } as const
})
