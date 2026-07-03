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

type NativeDropPayload = { type: string; paths: string[]; position: { x: number; y: number } }
type DragDropEvent = { payload: unknown }
type DragDropCallback = (event: DragDropEvent) => void
let capturedDragDropHandler: DragDropCallback | undefined
let nativeDropUnlisten = () => {
  capturedDragDropHandler = undefined
}

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    listen: vi.fn((_eventName: string, cb: DragDropCallback) => {
      capturedDragDropHandler = cb
      return Promise.resolve(nativeDropUnlisten)
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
    })
    expect(url).toBe('asset://localhost/vault/attachments/123-test.png')

    tauriMode = false
  })

  it('resolves native asset bridge failures to an empty upload state', async () => {
    tauriMode = true

    const nativeBridgeError = new Error('null pointer passed to rust')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockClear()
    vi.mocked(invoke).mockResolvedValue('/vault/attachments/123-test.png')
    vi.mocked(convertFileSrc).mockImplementation(() => {
      throw nativeBridgeError
    })

    try {
      const file = new File(['data'], 'test.png', { type: 'image/png' })

      await expect(uploadImageFile(file, '/vault')).resolves.toEqual({
        props: { name: 'test.png', url: '' },
      })
      expect(warn).toHaveBeenCalledWith(
        '[image-upload] Failed to prepare uploaded image asset URL:',
        nativeBridgeError,
      )
    } finally {
      vi.mocked(convertFileSrc).mockImplementation((path: string) => `asset://localhost/${path}`)
      warn.mockRestore()
      tauriMode = false
    }
  })

  it('rejects HEIC uploads before writing unsupported attachments', async () => {
    tauriMode = true

    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockClear()
    const file = new File(['heic-data'], 'iphone.HEIC', { type: 'image/heic' })

    await expect(uploadImageFile(file, '/vault')).rejects.toMatchObject({
      name: 'UnsupportedImageFormatError',
      fileName: 'iphone.HEIC',
      format: 'HEIC',
    })
    expect(invoke).not.toHaveBeenCalled()

    tauriMode = false
  })

  it('resolves unreadable local files to an empty upload state', async () => {
    tauriMode = true
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockClear()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const readError = new DOMException(
      'The requested file could not be read, typically due to permission problems.',
      'NotReadableError',
    )
    const arrayBuffer = vi.spyOn(File.prototype, 'arrayBuffer').mockRejectedValue(readError)

    try {
      const file = new File(['data'], 'protected.png', { type: 'image/png' })

      await expect(uploadImageFile(file, '/vault')).resolves.toEqual({
        props: { name: 'protected.png', url: '' },
      })
      expect(invoke).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(
        '[image-upload] Skipped unreadable file upload:',
        readError,
      )
    } finally {
      arrayBuffer.mockRestore()
      warn.mockRestore()
      tauriMode = false
    }
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
    nativeDropUnlisten = () => {
      capturedDragDropHandler = undefined
    }
    capturedDragDropHandler = undefined
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    tauriMode = false
    capturedDragDropHandler = undefined
    container.remove()
  })

  function renderImageDropTauri(opts?: {
    onImageImportError?: (error: { fileName: string; format: string; kind: string }) => void
    onImageUrl?: (url: string) => void
    vaultPath?: string
  }) {
    const ref = createRef<HTMLDivElement>()
    Object.defineProperty(ref, 'current', { value: container, writable: true })
    return renderHook(() => useImageDrop({ containerRef: ref, ...opts }))
  }

  function emitNativeDropEvent(payload: unknown) {
    if (!capturedDragDropHandler) throw new Error('No native drop handler registered')
    capturedDragDropHandler({ payload })
  }

  async function waitForNativeDropListeners() {
    await waitFor(() => {
      expect(capturedDragDropHandler).toBeDefined()
    })
  }

  it('registers the native window drag/drop listener', async () => {
    const { result } = renderImageDropTauri()

    await waitForNativeDropListeners()

    expect(result.current.isDragOver).toBe(false)
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
      emitNativeDropEvent({ type: 'drop', paths: ['/tmp/photo.png'], position: { x: 100, y: 100 } })
    })

    expect(result.current.isDragOver).toBe(false)
  })

  it('ignores malformed native drag-drop payloads without throwing', async () => {
    const { result } = renderImageDropTauri()

    await waitForNativeDropListeners()

    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    act(() => { container.dispatchEvent(createDragEvent('dragover', [file])) })
    expect(result.current.isDragOver).toBe(true)

    expect(() => {
      act(() => {
        emitNativeDropEvent(null)
      })
    }).not.toThrow()

    expect(result.current.isDragOver).toBe(false)
  })

  it('copies native image drops into the vault and emits attachment asset URLs', async () => {
    const onImageUrl = vi.fn()
    const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockClear()
    vi.mocked(convertFileSrc).mockClear()
    vi.mocked(invoke).mockResolvedValue('/vault/attachments/123-photo.png')
    vi.mocked(convertFileSrc).mockReturnValue('asset://localhost/vault/attachments/123-photo.png')
    renderImageDropTauri({ onImageUrl, vaultPath: '/vault' })

    await waitForNativeDropListeners()

    act(() => {
      emitNativeDropEvent({
        type: 'drop',
        paths: ['/tmp/photo.png', '/tmp/readme.txt'],
        position: { x: 100, y: 100 },
      } satisfies NativeDropPayload)
    })

    await waitFor(() => {
      expect(onImageUrl).toHaveBeenCalledWith('asset://localhost/vault/attachments/123-photo.png')
    })
    expect(invoke).toHaveBeenCalledWith('copy_image_to_vault', {
      vaultPath: '/vault',
      sourcePath: '/tmp/photo.png',
    })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported HEIC native drops without copying them into the vault', async () => {
    const onImageImportError = vi.fn()
    const onImageUrl = vi.fn()
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockClear()
    renderImageDropTauri({ onImageImportError, onImageUrl, vaultPath: '/vault' })

    await waitForNativeDropListeners()

    act(() => {
      emitNativeDropEvent({
        type: 'drop',
        paths: ['/tmp/iphone.HEIC'],
        position: { x: 100, y: 100 },
      } satisfies NativeDropPayload)
    })

    expect(onImageImportError).toHaveBeenCalledWith({
      kind: 'unsupported-heic',
      fileName: 'iphone.HEIC',
      format: 'HEIC',
    })
    expect(invoke).not.toHaveBeenCalled()
    expect(onImageUrl).not.toHaveBeenCalled()
  })

  it('handles active-vault boundary failures from native image drops', async () => {
    const onImageUrl = vi.fn()
    const onUnhandledRejection = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockClear()
    vi.mocked(invoke).mockRejectedValue('Path must stay inside the active vault')
    process.on('unhandledRejection', onUnhandledRejection)
    try {
      renderImageDropTauri({ onImageUrl, vaultPath: '/vault' })

      await waitForNativeDropListeners()

      act(() => {
        emitNativeDropEvent({
          type: 'drop',
          paths: ['/tmp/photo.png'],
          position: { x: 100, y: 100 },
        } satisfies NativeDropPayload)
      })

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('copy_image_to_vault', {
          vaultPath: '/vault',
          sourcePath: '/tmp/photo.png',
        })
      })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(warn).toHaveBeenCalledWith(
        '[image-drop] Failed to copy dropped image into vault:',
        'Path must stay inside the active vault',
      )
      expect(onUnhandledRejection).not.toHaveBeenCalled()
      expect(onImageUrl).not.toHaveBeenCalled()
    } finally {
      process.removeListener('unhandledRejection', onUnhandledRejection)
      warn.mockRestore()
    }
  })

  it('resets isDragOver on Tauri leave event', async () => {
    const { result } = renderImageDropTauri()

    await waitForNativeDropListeners()

    // Set isDragOver via HTML5 dragover first
    const file = new File(['data'], 'photo.png', { type: 'image/png' })
    act(() => { container.dispatchEvent(createDragEvent('dragover', [file])) })
    expect(result.current.isDragOver).toBe(true)

    act(() => {
      emitNativeDropEvent({ type: 'leave', paths: [], position: { x: 0, y: 0 } })
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
