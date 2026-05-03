import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { uploadImageFile, useImageDrop } from './useImageDrop'
import { createRef } from 'react'

let tauriMode = false

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => tauriMode,
}))

type DragDropEvent = { payload: { type: string; paths: string[]; position: { x: number; y: number } } }
type DragDropCallback = (event: DragDropEvent) => void
const capturedDragDropHandlers: Record<string, DragDropCallback | undefined> = {}
let nativeDropUnlisten: (eventName: string) => void = (eventName) => {
  delete capturedDragDropHandlers[eventName]
}

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    listen: vi.fn((eventName: string, cb: DragDropCallback) => {
      capturedDragDropHandlers[eventName] = cb
      return Promise.resolve(() => nativeDropUnlisten(eventName))
    }),
  }),
}))

// JSDOM lacks DragEvent and File.arrayBuffer — polyfill for tests
beforeAll(() => {
  if (typeof globalThis.DragEvent === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).DragEvent = class DragEvent extends MouseEvent {
      dataTransfer: DataTransfer | null
      constructor(type: string, init?: DragEventInit) {
        super(type, init)
        this.dataTransfer = init?.dataTransfer ?? null
      }
    }
  }

  // File.prototype.arrayBuffer may be missing in older JSDOM
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function () {
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.readAsArrayBuffer(this)
      })
    }
  }
})

// Mock DataTransfer (JSDOM doesn't implement it)
function createMockDataTransfer(files: File[]) {
  const items = files.map(f => ({ kind: 'file' as const, type: f.type, getAsFile: () => f }))
  return {
    items: { ...items, length: items.length },
    files: Object.assign(files, { item: (i: number) => files[i] }),
    dropEffect: 'none',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as DataTransfer
}

function createDragEvent(type: string, files: File[], opts?: { relatedTarget?: EventTarget | null }) {
  const dt = createMockDataTransfer(files)
  return new DragEvent(type, {
    dataTransfer: dt,
    bubbles: true,
    cancelable: true,
    relatedTarget: opts?.relatedTarget ?? null,
  })
}

describe('uploadImageFile', () => {
  it('returns a data URL in browser mode', async () => {
    const blob = new Blob(['fake-image-data'], { type: 'image/png' })
    const file = new File([blob], 'test.png', { type: 'image/png' })

    const url = await uploadImageFile(file)
    expect(url).toMatch(/^data:image\/png;base64,/)
  })

  it('passes file to Tauri save_image in Tauri mode', async () => {
    tauriMode = true

    const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue('/vault/attachments/123-test.png')
    vi.mocked(convertFileSrc).mockReturnValue('asset://localhost/vault/attachments/123-test.png')

    const blob = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })
    const file = new File([blob], 'test.png', { type: 'image/png' })

    const url = await uploadImageFile(file, '/vault')
    expect(invoke).toHaveBeenCalledWith('save_image', {
      vaultPath: '/vault',
      filename: 'test.png',
      data: expect.any(String),
      folder: null,
    })
    expect(url).toBe('asset://localhost/vault/attachments/123-test.png')

    tauriMode = false
  })

  it('forwards a custom folder to save_image when provided', async () => {
    tauriMode = true

    const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue('/vault/Media/Images/123-test.png')
    vi.mocked(convertFileSrc).mockReturnValue('asset://localhost/vault/Media/Images/123-test.png')

    const blob = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })
    const file = new File([blob], 'test.png', { type: 'image/png' })

    await uploadImageFile(file, '/vault', 'Media/Images')
    expect(invoke).toHaveBeenCalledWith('save_image', {
      vaultPath: '/vault',
      filename: 'test.png',
      data: expect.any(String),
      folder: 'Media/Images',
    })

    tauriMode = false
  })

  it('routes a video file through save_video', async () => {
    tauriMode = true

    const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue('/vault/Media/Videos/123-clip.mp4')
    vi.mocked(convertFileSrc).mockReturnValue('asset://localhost/vault/Media/Videos/123-clip.mp4')

    const blob = new Blob([new Uint8Array([0x00, 0x01])], { type: 'video/mp4' })
    const file = new File([blob], 'clip.mp4', { type: 'video/mp4' })

    await uploadImageFile(file, '/vault', 'Media/Videos')
    expect(invoke).toHaveBeenCalledWith('save_video', {
      vaultPath: '/vault',
      filename: 'clip.mp4',
      data: expect.any(String),
      folder: 'Media/Videos',
    })

    tauriMode = false
  })
})

describe('useImageDrop', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  function renderImageDrop(opts?: { onImageUrl?: (url: string) => void; vaultPath?: string }) {
    const ref = createRef<HTMLDivElement>()
    Object.defineProperty(ref, 'current', { value: container, writable: true })
    return renderHook(() => useImageDrop({ containerRef: ref, ...opts }))
  }

  it('sets isDragOver to true on dragover with image files', () => {
    const { result } = renderImageDrop()
    const file = new File(['data'], 'photo.png', { type: 'image/png' })

    act(() => { container.dispatchEvent(createDragEvent('dragover', [file])) })
    expect(result.current.isDragOver).toBe(true)
  })

  it('ignores dragover with non-image files', () => {
    const { result } = renderImageDrop()
    const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' })

    act(() => { container.dispatchEvent(createDragEvent('dragover', [file])) })
    expect(result.current.isDragOver).toBe(false)
  })

  it('resets isDragOver on dragleave when leaving container', () => {
    const { result } = renderImageDrop()
    const file = new File(['data'], 'photo.png', { type: 'image/png' })

    act(() => { container.dispatchEvent(createDragEvent('dragover', [file])) })
    expect(result.current.isDragOver).toBe(true)

    act(() => { container.dispatchEvent(createDragEvent('dragleave', [], { relatedTarget: document.body })) })
    expect(result.current.isDragOver).toBe(false)
  })

  it('resets isDragOver on drop (upload handled by BlockNote natively)', () => {
    const { result } = renderImageDrop()
    const file = new File(['data'], 'photo.png', { type: 'image/png' })

    act(() => { container.dispatchEvent(createDragEvent('dragover', [file])) })
    expect(result.current.isDragOver).toBe(true)

    act(() => { container.dispatchEvent(createDragEvent('drop', [file])) })
    expect(result.current.isDragOver).toBe(false)
  })

  it('accepts jpeg, gif, and webp types', () => {
    const { result } = renderImageDrop()

    for (const type of ['image/jpeg', 'image/gif', 'image/webp']) {
      const file = new File(['data'], `img.${type.split('/')[1]}`, { type })
      act(() => { container.dispatchEvent(createDragEvent('dragover', [file])) })
      expect(result.current.isDragOver).toBe(true)

      act(() => { container.dispatchEvent(createDragEvent('dragleave', [], { relatedTarget: document.body })) })
    }
  })

  it('passes onImageUrl and vaultPath without error', () => {
    const onImageUrl = vi.fn()
    const { result } = renderImageDrop({ onImageUrl, vaultPath: '/vault' })
    // Should render without error; Tauri event listener is skipped in browser mode
    expect(result.current.isDragOver).toBe(false)
  })
})

describe('useImageDrop — Tauri native drag-drop', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    tauriMode = true
    nativeDropUnlisten = (eventName) => {
      delete capturedDragDropHandlers[eventName]
    }
    for (const eventName of Object.keys(capturedDragDropHandlers)) delete capturedDragDropHandlers[eventName]
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    tauriMode = false
    for (const eventName of Object.keys(capturedDragDropHandlers)) delete capturedDragDropHandlers[eventName]
    container.remove()
  })

  function renderImageDropTauri(opts?: { onImageUrl?: (url: string) => void; vaultPath?: string }) {
    const ref = createRef<HTMLDivElement>()
    Object.defineProperty(ref, 'current', { value: container, writable: true })
    return renderHook(() => useImageDrop({ containerRef: ref, ...opts }))
  }

  function emitNativeDropEvent(eventName: string, payload: DragDropEvent['payload']) {
    const handler = capturedDragDropHandlers[eventName]
    if (!handler) throw new Error(`No native drop handler registered for ${eventName}`)
    handler({ payload })
  }

  async function waitForNativeDropListeners() {
    await waitFor(() => {
      expect(capturedDragDropHandlers['tauri://drag-drop']).toBeDefined()
      expect(capturedDragDropHandlers['tauri://drag-leave']).toBeDefined()
    })
  }

  it('registers only native events that carry actionable drop state', async () => {
    const { result } = renderImageDropTauri()

    await waitForNativeDropListeners()

    expect(result.current.isDragOver).toBe(false)
    expect(capturedDragDropHandlers['tauri://drag-over']).toBeUndefined()
  })

  it('resets isDragOver on Tauri drop event', async () => {
    const onImageUrl = vi.fn()
    const { result } = renderImageDropTauri({ onImageUrl, vaultPath: '/vault' })

    await waitForNativeDropListeners()

    // Set isDragOver via HTML5 dragover (simulates real OS file drag)
    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    act(() => { container.dispatchEvent(createDragEvent('dragover', [file])) })
    expect(result.current.isDragOver).toBe(true)

    act(() => {
      emitNativeDropEvent('tauri://drag-drop', { type: 'drop', paths: ['/tmp/photo.png'], position: { x: 100, y: 100 } })
    })

    expect(result.current.isDragOver).toBe(false)
  })

  it('resets isDragOver on Tauri leave event', async () => {
    const { result } = renderImageDropTauri()

    await waitForNativeDropListeners()

    // Set isDragOver via HTML5 dragover first
    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    act(() => { container.dispatchEvent(createDragEvent('dragover', [file])) })
    expect(result.current.isDragOver).toBe(true)

    act(() => {
      emitNativeDropEvent('tauri://drag-leave', { type: 'leave', paths: [], position: { x: 0, y: 0 } })
    })

    expect(result.current.isDragOver).toBe(false)
  })

  it('swallows duplicate native unlisten failures from dev-mode remounts', async () => {
    nativeDropUnlisten = () => {
      throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')")
    }
    const { unmount } = renderImageDropTauri()

    await waitForNativeDropListeners()

    expect(() => unmount()).not.toThrow()
  })
})
