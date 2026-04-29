import { useEffect, useRef, type MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'

export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

export function useEditorMountState(
  editor: ReturnType<typeof useCreateBlockNote>,
  editorMountedRef: MutableRefObject<boolean>,
  pendingSwapRef: MutableRefObject<(() => void) | null>,
) {
  useEffect(() => {
    if (editor.prosemirrorView) {
      editorMountedRef.current = true
    }
    const cleanup = editor.onMount(() => {
      editorMountedRef.current = true
      if (pendingSwapRef.current) {
        const swap = pendingSwapRef.current
        pendingSwapRef.current = null
        queueMicrotask(swap)
      }
    })
    return cleanup
  }, [editor, editorMountedRef, pendingSwapRef])
}
