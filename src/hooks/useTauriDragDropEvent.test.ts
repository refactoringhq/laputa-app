import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTauriDragDropEvent } from './useTauriDragDropEvent'

let tauriMode = true

type NativeDragDropPayload = {
  type: string
  paths: string[]
  position: { x: number; y: number }
}
type CapturedDragDropHandler = (event: { payload: unknown }) => void

let capturedDragDropHandler: CapturedDragDropHandler | undefined
const unlisten = vi.fn()
const onDragDropEvent = vi.fn((handler: CapturedDragDropHandler) => {
  capturedDragDropHandler = handler
  return Promise.resolve(unlisten)
})

vi.mock('../mock-tauri', () => ({
  isTauri: () => tauriMode,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent,
  }),
}))

function emitNativeDragDropPayload(payload: unknown): void {
  if (!capturedDragDropHandler) throw new Error('No native drag-drop handler registered')
  capturedDragDropHandler({ payload })
}

async function waitForNativeDragDropListener(): Promise<void> {
  await waitFor(() => {
    expect(capturedDragDropHandler).toBeDefined()
  })
}

describe('useTauriDragDropEvent', () => {
  beforeEach(() => {
    tauriMode = true
    capturedDragDropHandler = undefined
    onDragDropEvent.mockClear()
    unlisten.mockClear()
  })

  afterEach(() => {
    tauriMode = false
    capturedDragDropHandler = undefined
  })

  it('does not forward null native drag-drop payloads to consumers', async () => {
    const handler = vi.fn()
    renderHook(() => useTauriDragDropEvent(handler))

    await waitForNativeDragDropListener()

    expect(() => {
      emitNativeDragDropPayload(null)
    }).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })

  it('forwards valid native drag-drop payloads to consumers', async () => {
    const handler = vi.fn()
    renderHook(() => useTauriDragDropEvent(handler))

    await waitForNativeDragDropListener()

    const payload = {
      type: 'drop',
      paths: ['/tmp/photo.png'],
      position: { x: 10, y: 20 },
    } satisfies NativeDragDropPayload
    emitNativeDragDropPayload(payload)

    expect(handler).toHaveBeenCalledWith({ payload })
  })
})
