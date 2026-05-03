import { normalizeInlineWikilinkValue } from './inlineWikilinkTokens'

function normalizeDroppedFileUrl(value: string): string {
  if (!value.startsWith('file://')) return value

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'file:') return value

    const decodedPath = decodeURIComponent(parsed.pathname)
    if (parsed.hostname) return `//${parsed.hostname}${decodedPath}`
    if (/^\/[A-Za-z]:/.test(decodedPath)) return decodedPath.slice(1)
    return decodedPath
  } catch {
    return value
  }
}

function formatDroppedPath(path: string): string {
  return /\s/.test(path) ? JSON.stringify(path) : path
}

export function formatDroppedPathList(paths: string[]): string | null {
  const cleanedPaths = paths
    .map((path) => normalizeDroppedFileUrl(path.trim()))
    .filter(Boolean)

  if (cleanedPaths.length === 0) return null
  return cleanedPaths.map(formatDroppedPath).join(' ')
}

function normalizeDroppedTransferText(rawText: string): string | null {
  const trimmedText = normalizeInlineWikilinkValue(rawText).trim()
  if (!trimmedText) return null

  const lines = trimmedText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length > 0 && lines.every((line) => line.startsWith('file://'))) {
    return formatDroppedPathList(lines)
  }

  return trimmedText
}

export function extractDroppedPathText(dataTransfer: DataTransfer): string | null {
  const plainText = normalizeDroppedTransferText(dataTransfer.getData('text/plain'))
  if (plainText) return plainText

  const uriPaths = dataTransfer.getData('text/uri-list')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map(normalizeDroppedFileUrl)

  const uriPathText = formatDroppedPathList(uriPaths)
  if (uriPathText) return uriPathText

  const filePaths = Array.from(dataTransfer.files)
    .map((file) => (typeof (file as File & { path?: string }).path === 'string'
      ? (file as File & { path?: string }).path!.trim()
      : ''))
    .filter(Boolean)

  const filePathText = formatDroppedPathList(filePaths)
  if (filePathText) return filePathText

  return null
}
