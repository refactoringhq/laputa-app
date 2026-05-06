import { useEffect, useRef, useState, type RefObject } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event'
import type { DragDropEvent as TauriDragDropPayload } from '@tauri-apps/api/webview'
import { isTauri } from '../mock-tauri'

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff']
const TAURI_DRAG_DROP_EVENT = 'tauri://drag-drop'
const TAURI_DRAG_LEAVE_EVENT = 'tauri://drag-leave'

type ImageUrlHandler = (url: string) => void
type TauriDropEvent = TauriEvent<TauriDragDropPayload>

function hasImageFiles(dt: DataTransfer): boolean {
  for (let i = 0; i < dt.items.length; i++) {
    if (dt.items[i].kind === 'file' && IMAGE_MIME_TYPES.includes(dt.items[i].type)) return true
  }
  return false
}

function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.includes(ext)
}

/** Upload an image file — saves to vault/attachments in Tauri, returns data URL in browser */
export async function uploadImageFile(file: File, vaultPath?: string): Promise<string> {
  if (isTauri() && vaultPath) {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)
    const savedPath = await invoke<string>('save_image', {
      vaultPath,
      filename: file.name,
      data: base64,
    })
    return convertFileSrc(savedPath)
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Copy a dropped file (by OS path) into vault/attachments and return its asset URL. */
async function copyImageToVault(sourcePath: string, vaultPath: string): Promise<string> {
  const savedPath = await invoke<string>('copy_image_to_vault', { vaultPath, sourcePath })
  return convertFileSrc(savedPath)
}

function insertDroppedImages(
  imagePaths: string[],
  vaultPath: string | undefined,
  onImageUrl: ImageUrlHandler | undefined,
): void {
  if (imagePaths.length === 0) return
  if (!vaultPath || !onImageUrl) return

  for (const sourcePath of imagePaths) {
    void copyImageToVault(sourcePath, vaultPath).then(onImageUrl)
  }
}

function cleanupNativeDropListeners(unlisteners: UnlistenFn[]): void {
  for (const unlisten of unlisteners) {
    void Promise.resolve()
      .then(unlisten)
      .catch(() => {})
  }
}

async function registerNativeDropListeners(
  handler: (event: TauriDropEvent) => void,
): Promise<UnlistenFn[]> {
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  const webview = getCurrentWebview()
  const unlisteners: UnlistenFn[] = []

  try {
    unlisteners.push(await webview.listen<TauriDragDropPayload>(TAURI_DRAG_DROP_EVENT, handler))
    unlisteners.push(await webview.listen<TauriDragDropPayload>(TAURI_DRAG_LEAVE_EVENT, handler))
    return unlisteners
  } catch (error) {
    cleanupNativeDropListeners(unlisteners)
    throw error
  }
}

interface UseImageDropOptions {
  containerRef: RefObject<HTMLDivElement | null>
  /** Called with an asset URL for each image dropped via Tauri native drag-drop. */
  onImageUrl?: (url: string) => void
  vaultPath?: string
}

export function useImageDrop({ containerRef, onImageUrl, vaultPath }: UseImageDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false)
  const onImageUrlRef = useRef(onImageUrl)
  useEffect(() => { onImageUrlRef.current = onImageUrl }, [onImageUrl])
  const vaultPathRef = useRef(vaultPath)
  useEffect(() => { vaultPathRef.current = vaultPath }, [vaultPath])

  // HTML5 DnD visual feedback; BlockNote handles browser-mode uploads.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer || !hasImageFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!container.contains(e.relatedTarget as Node)) {
        setIsDragOver(false)
      }
    }

    const handleDrop = () => {
      setIsDragOver(false)
    }

    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('dragleave', handleDragLeave)
    container.addEventListener('drop', handleDrop)

    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('dragleave', handleDragLeave)
      container.removeEventListener('drop', handleDrop)
    }
  }, [containerRef])

  // Tauri native file drop intercepts OS file drops that bypass HTML5 DnD.
  useEffect(() => {
    if (!isTauri()) return

    let unlisteners: UnlistenFn[] = []
    let mounted = true

    void (async () => {
      try {
        const nextUnlisteners = await registerNativeDropListeners((event) => {
          if (event.payload.type === 'drop') {
            setIsDragOver(false)
            insertDroppedImages(
              event.payload.paths.filter(isImagePath),
              vaultPathRef.current,
              onImageUrlRef.current,
            )
            return
          }
          setIsDragOver(false)
        })
        if (mounted) unlisteners = nextUnlisteners
        else cleanupNativeDropListeners(nextUnlisteners)
      } catch {
        // Tauri webview API not available.
      }
    })()

    return () => {
      mounted = false
      cleanupNativeDropListeners(unlisteners)
      unlisteners = []
    }
  }, [])

  return { isDragOver }
}
