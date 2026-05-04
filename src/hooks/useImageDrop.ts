import { useEffect, useRef, useState, type RefObject } from 'react'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'
import { useTauriDragDropEvent, type TauriDragDropEvent } from './useTauriDragDropEvent'

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tiff']
const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']

type MediaUrlHandler = (url: string) => void
type MediaKind = 'image' | 'video'

function hasMediaFiles(dt: DataTransfer): boolean {
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i]
    if (item.kind !== 'file') continue
    if (IMAGE_MIME_TYPES.includes(item.type) || VIDEO_MIME_TYPES.includes(item.type)) return true
  }
  return false
}

function pathExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

function classifyPath(path: string): MediaKind | null {
  const ext = pathExtension(path)
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  return null
}

function classifyFile(file: File): MediaKind | null {
  if (IMAGE_MIME_TYPES.includes(file.type)) return 'image'
  if (VIDEO_MIME_TYPES.includes(file.type)) return 'video'
  return classifyPath(file.name)
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** Upload a media file. In Tauri mode, saves into the vault under the resolved
 *  folder; in browser mode, returns a data URL. `folder` is optional — when omitted
 *  the Rust side falls back to "attachments". */
export async function uploadImageFile(
  file: File,
  vaultPath?: string,
  folder?: string | null,
): Promise<string> {
  const kind = classifyFile(file) ?? 'image'
  if (isTauri() && vaultPath) {
    const base64 = await fileToBase64(file)
    const command = kind === 'video' ? 'save_video' : 'save_image'
    const savedPath = await invoke<string>(command, {
      vaultPath,
      filename: file.name,
      data: base64,
      folder: folder ?? null,
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

/** Tauri-native drop: copy a file (image or video) by OS path into the vault. */
async function copyMediaToVault(
  sourcePath: string,
  vaultPath: string,
  folder: string | null,
  kind: MediaKind,
): Promise<string> {
  const command = kind === 'video' ? 'copy_video_to_vault' : 'copy_image_to_vault'
  const savedPath = await invoke<string>(command, { vaultPath, sourcePath, folder })
  return convertFileSrc(savedPath)
}

interface DropContext {
  vaultPath: string | undefined
  imageFolder: string | null
  videoFolder: string | null
  onMediaUrl: MediaUrlHandler | undefined
}

function insertDroppedMedia(paths: string[], ctx: DropContext): void {
  if (paths.length === 0) return
  if (!ctx.vaultPath || !ctx.onMediaUrl) return

  for (const sourcePath of paths) {
    const kind = classifyPath(sourcePath)
    if (!kind) continue
    const folder = kind === 'video' ? ctx.videoFolder : ctx.imageFolder
    void copyMediaToVault(sourcePath, ctx.vaultPath, folder, kind).then(ctx.onMediaUrl)
  }
}

interface UseImageDropOptions {
  containerRef: RefObject<HTMLDivElement | null>
  /** Called with an asset URL for each media file dropped via Tauri native drag-drop. */
  onImageUrl?: (url: string) => void
  vaultPath?: string
  /** Vault-relative folder for images (from settings). null/undefined = "attachments". */
  imageFolder?: string | null
  /** Vault-relative folder for videos (from settings). null/undefined = "attachments". */
  videoFolder?: string | null
}

function useLatestImageDropRefs(
  onImageUrl: MediaUrlHandler | undefined,
  vaultPath: string | undefined,
  imageFolder: string | null | undefined,
  videoFolder: string | null | undefined,
) {
  const onImageUrlRef = useRef(onImageUrl)
  const vaultPathRef = useRef(vaultPath)
  const imageFolderRef = useRef<string | null>(imageFolder ?? null)
  const videoFolderRef = useRef<string | null>(videoFolder ?? null)

  useEffect(() => { onImageUrlRef.current = onImageUrl }, [onImageUrl])
  useEffect(() => { vaultPathRef.current = vaultPath }, [vaultPath])
  useEffect(() => { imageFolderRef.current = imageFolder ?? null }, [imageFolder])
  useEffect(() => { videoFolderRef.current = videoFolder ?? null }, [videoFolder])

  return { onImageUrlRef, vaultPathRef, imageFolderRef, videoFolderRef }
}

function useHtmlImageDropFeedback(
  containerRef: RefObject<HTMLDivElement | null>,
  setIsDragOver: (isDragOver: boolean) => void,
) {
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer || !hasMediaFiles(e.dataTransfer)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }

    const handleDragLeave = (e: DragEvent) => {
      if (!container.contains(e.relatedTarget as Node)) setIsDragOver(false)
    }

    const handleDrop = () => setIsDragOver(false)

    container.addEventListener('dragover', handleDragOver)
    container.addEventListener('dragleave', handleDragLeave)
    container.addEventListener('drop', handleDrop)

    return () => {
      container.removeEventListener('dragover', handleDragOver)
      container.removeEventListener('dragleave', handleDragLeave)
      container.removeEventListener('drop', handleDrop)
    }
  }, [containerRef, setIsDragOver])
}

function handleNativeMediaDrop(
  event: TauriDragDropEvent,
  ctx: DropContext,
): void {
  if (event.payload.type !== 'drop') return
  insertDroppedMedia(
    event.payload.paths.filter((path) => classifyPath(path) !== null),
    ctx,
  )
}

export function useImageDrop({
  containerRef,
  onImageUrl,
  vaultPath,
  imageFolder,
  videoFolder,
}: UseImageDropOptions) {
  const [isDragOver, setIsDragOver] = useState(false)
  const { onImageUrlRef, vaultPathRef, imageFolderRef, videoFolderRef } = useLatestImageDropRefs(
    onImageUrl,
    vaultPath,
    imageFolder,
    videoFolder,
  )

  useHtmlImageDropFeedback(containerRef, setIsDragOver)
  useTauriDragDropEvent((event) => {
    setIsDragOver(false)
    handleNativeMediaDrop(event, {
      vaultPath: vaultPathRef.current,
      imageFolder: imageFolderRef.current,
      videoFolder: videoFolderRef.current,
      onMediaUrl: onImageUrlRef.current,
    })
  })

  return { isDragOver }
}
