import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core'
import { useEffect, useRef, useState } from 'react'

function eventTargetsEditor(editorElement: Element, target: EventTarget | null) {
  return target instanceof Node && editorElement.contains(target)
}

export function useEditorComposing<
  BSchema extends BlockSchema,
  ISchema extends InlineContentSchema,
  SSchema extends StyleSchema,
>(editor: BlockNoteEditor<BSchema, ISchema, SSchema>) {
  const [isComposing, setIsComposing] = useState(false)
  const composingRef = useRef(false)
  const editorElement = editor.domElement ?? null

  useEffect(() => {
    const updateComposing = (nextIsComposing: boolean) => {
      if (composingRef.current === nextIsComposing) return
      composingRef.current = nextIsComposing
      setIsComposing(nextIsComposing)
    }

    updateComposing(false)

    if (!editorElement) return

    const handleCompositionStart = (event: CompositionEvent) => {
      if (!eventTargetsEditor(editorElement, event.target)) return
      updateComposing(true)
    }

    const handleCompositionEnd = (event: CompositionEvent) => {
      if (
        !composingRef.current
        && !eventTargetsEditor(editorElement, event.target)
      ) {
        return
      }

      updateComposing(false)
    }

    document.addEventListener('compositionstart', handleCompositionStart, true)
    document.addEventListener('compositionend', handleCompositionEnd, true)

    return () => {
      document.removeEventListener('compositionstart', handleCompositionStart, true)
      document.removeEventListener('compositionend', handleCompositionEnd, true)
    }
  }, [editorElement])

  return isComposing
}
