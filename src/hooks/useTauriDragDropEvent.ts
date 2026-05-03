import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event'
import type { DragDropEvent as TauriDragDropPayload } from '@tauri-apps/api/window'
import { isTauri } from '../mock-tauri'

export type TauriDragDropEvent = TauriEvent<TauriDragDropPayload>
type TauriDragDropHandler = (event: TauriDragDropEvent) => void

function cleanupNativeDropListeners(unlisteners: UnlistenFn[]): void {
  for (const unlisten of unlisteners) {
    void Promise.resolve()
      .then(unlisten)
      .catch(() => {})
  }
}

async function registerNativeDropListener(handler: TauriDragDropHandler): Promise<UnlistenFn> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().onDragDropEvent(handler)
}

export function useTauriDragDropEvent(handler: TauriDragDropHandler) {
  const handlerRef = useRef(handler)

  useLayoutEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!isTauri()) return

    let mounted = true
    let unlisteners: UnlistenFn[] = []

    void registerNativeDropListener((event) => handlerRef.current(event))
      .then((unlisten) => {
        if (mounted) unlisteners = [unlisten]
        else cleanupNativeDropListeners([unlisten])
      })
      .catch(() => {})

    return () => {
      mounted = false
      cleanupNativeDropListeners(unlisteners)
      unlisteners = []
    }
  }, [])
}
