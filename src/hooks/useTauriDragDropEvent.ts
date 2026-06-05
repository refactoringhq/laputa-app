import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event'
import type { DragDropEvent as TauriDragDropPayload } from '@tauri-apps/api/window'
import { isTauri } from '../mock-tauri'
import { cleanupTauriEventListeners } from '../utils/tauriEventCleanup'

export type TauriDragDropEvent = TauriEvent<TauriDragDropPayload>
type TauriDragDropHandler = (event: TauriDragDropEvent) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function hasDropPosition(value: unknown): boolean {
  if (!isRecord(value)) return false
  return typeof Reflect.get(value, 'x') === 'number'
    && typeof Reflect.get(value, 'y') === 'number'
}

function isNativeDropPayload(payload: unknown): payload is TauriDragDropPayload {
  if (!isRecord(payload)) return false
  const type = Reflect.get(payload, 'type')
  if (typeof type !== 'string') return false
  if (type !== 'drop') return true
  return isStringArray(Reflect.get(payload, 'paths'))
    && hasDropPosition(Reflect.get(payload, 'position'))
}

async function registerNativeDropListener(handler: TauriDragDropHandler): Promise<UnlistenFn> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow().onDragDropEvent((event) => {
    if (isNativeDropPayload(event.payload)) handler(event as TauriDragDropEvent)
  })
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
        else cleanupTauriEventListeners([unlisten])
      })
      .catch(() => {})

    return () => {
      mounted = false
      cleanupTauriEventListeners(unlisteners)
      unlisteners = []
    }
  }, [])
}
