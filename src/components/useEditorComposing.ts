import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core'
import { useEffect, useRef, useState } from 'react'

const COMPOSITION_SETTLE_MS = 250

function eventTargetsEditor(editorElement: Element, target: EventTarget | null) {
  return target instanceof Node && editorElement.contains(target)
}

function focusTargetsEditor(editorElement: Element) {
  const activeElement = editorElement.ownerDocument.activeElement
  return activeElement instanceof Node && editorElement.contains(activeElement)
}

function selectionTargetsEditor(editorElement: Element) {
  const anchorNode = editorElement.ownerDocument.getSelection()?.anchorNode
  return anchorNode instanceof Node && editorElement.contains(anchorNode)
}

function compositionEventTargetsEditor(
  editorElement: Element,
  event: CompositionEvent,
) {
  return eventTargetsEditor(editorElement, event.target)
    || focusTargetsEditor(editorElement)
    || selectionTargetsEditor(editorElement)
}

export function useEditorComposing<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(editor: BlockNoteEditor<BSchema, ISchema, SSchema>) {
  const [isComposing, setIsComposing] = useState(false)
  const composingRef = useRef(false)
  const settleTimeoutRef = useRef<number | null>(null)
  const editorElement = editor.domElement ?? null

  useEffect(() => {
    const clearSettleTimeout = () => {
      if (settleTimeoutRef.current === null) return
      window.clearTimeout(settleTimeoutRef.current)
      settleTimeoutRef.current = null
    }

    const updateComposing = (nextIsComposing: boolean) => {
      if (composingRef.current === nextIsComposing) return
      composingRef.current = nextIsComposing
      setIsComposing(nextIsComposing)
    }

    const startComposing = () => {
      clearSettleTimeout()
      updateComposing(true)
    }

    const finishComposing = () => {
      clearSettleTimeout()
      settleTimeoutRef.current = window.setTimeout(() => {
        settleTimeoutRef.current = null
        updateComposing(false)
      }, COMPOSITION_SETTLE_MS)
    }

    clearSettleTimeout()
    updateComposing(false)

    if (!editorElement) return

    const handleCompositionStart = (event: CompositionEvent) => {
      if (!compositionEventTargetsEditor(editorElement, event)) return
      startComposing()
    }

    const handleCompositionUpdate = (event: CompositionEvent) => {
      if (!compositionEventTargetsEditor(editorElement, event)) return
      startComposing()
    }

    const handleCompositionEnd = (event: CompositionEvent) => {
      if (
        !composingRef.current
        && !compositionEventTargetsEditor(editorElement, event)
      ) {
        return
      }

      finishComposing()
    }

    const handleCompositionCancel: EventListener = (event) => {
      if (event instanceof CompositionEvent) {
        handleCompositionEnd(event)
        return
      }

      if (!composingRef.current) return
      finishComposing()
    }

    document.addEventListener('compositionstart', handleCompositionStart, true)
    document.addEventListener('compositionupdate', handleCompositionUpdate, true)
    document.addEventListener('compositionend', handleCompositionEnd, true)
    document.addEventListener('compositioncancel', handleCompositionCancel, true)

    return () => {
      clearSettleTimeout()
      document.removeEventListener('compositionstart', handleCompositionStart, true)
      document.removeEventListener('compositionupdate', handleCompositionUpdate, true)
      document.removeEventListener('compositionend', handleCompositionEnd, true)
      document.removeEventListener('compositioncancel', handleCompositionCancel, true)
    }
  }, [editorElement])

  return isComposing
}
