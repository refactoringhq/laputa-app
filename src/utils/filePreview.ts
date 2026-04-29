import type { VaultEntry } from '../types'

export type FilePreviewKind = 'image' | 'pdf'

const IMAGE_PREVIEW_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
])
const PDF_PREVIEW_EXTENSIONS = new Set(['pdf'])

function extensionFromFilename(filename: string): string | null {
  const lastSegment = filename.split(/[\\/]/u).pop() ?? filename
  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return null
  return lastSegment.slice(dotIndex + 1).toLowerCase()
}

export function previewExtension(entry: Pick<VaultEntry, 'filename' | 'path'>): string | null {
  return extensionFromFilename(entry.filename) ?? extensionFromFilename(entry.path)
}

export function isImagePreviewEntry(entry: Pick<VaultEntry, 'fileKind' | 'filename' | 'path'>): boolean {
  return filePreviewKind(entry) === 'image'
}

export function isPdfPreviewEntry(entry: Pick<VaultEntry, 'fileKind' | 'filename' | 'path'>): boolean {
  return filePreviewKind(entry) === 'pdf'
}

export function filePreviewKind(entry: Pick<VaultEntry, 'fileKind' | 'filename' | 'path'>): FilePreviewKind | null {
  if (entry.fileKind && entry.fileKind !== 'binary') return null

  const extension = previewExtension(entry)
  if (!extension) return null
  if (IMAGE_PREVIEW_EXTENSIONS.has(extension)) return 'image'
  if (PDF_PREVIEW_EXTENSIONS.has(extension)) return 'pdf'
  return null
}

export function isFilePreviewEntry(entry: Pick<VaultEntry, 'fileKind' | 'filename' | 'path'>): boolean {
  return filePreviewKind(entry) !== null
}

export function previewFileTypeLabel(entry: Pick<VaultEntry, 'filename' | 'path'>): string {
  const extension = previewExtension(entry)
  return extension ? `${extension.toUpperCase()} file` : 'File'
}
