import { isTauri } from '../mock-tauri'
import { writeClipboardText } from './clipboardText'

type ExternalUrlCandidate = string
type AbsoluteFilePath = string

function parseHttpUrl(candidate: ExternalUrlCandidate): URL | null {
  try {
    const parsedUrl = new URL(candidate)
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' ? parsedUrl : null
  } catch {
    return null
  }
}

function hasBareDomainHost(parsedUrl: URL): boolean {
  const dotIndex = parsedUrl.hostname.lastIndexOf('.')
  return dotIndex > 0 && dotIndex <= parsedUrl.hostname.length - 3
}

function startsWithHttpProtocol(url: ExternalUrlCandidate): boolean {
  const lowerUrl = url.toLowerCase()
  return lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (!error || typeof error !== 'object') return ''

  const message = Reflect.get(error, 'message')
  return typeof message === 'string' ? message : ''
}

function isExternalOpenCanceledByUser(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes('os error 1223') ||
    message.includes('operation was canceled by the user') ||
    message.includes('operation was cancelled by the user')
}

export function normalizeExternalUrl(value: ExternalUrlCandidate): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  for (const char of trimmed) {
    if (char.trim() === '') return null
  }

  if (parseHttpUrl(trimmed)) return trimmed
  if (!trimmed.includes('.')) return null

  const bareDomainCandidate = `https://${trimmed}`
  const parsedBareDomain = parseHttpUrl(bareDomainCandidate)
  if (!parsedBareDomain || !hasBareDomainHost(parsedBareDomain)) return null
  return bareDomainCandidate
}

export function isUrlValue(value: ExternalUrlCandidate): boolean {
  return normalizeExternalUrl(value) !== null
}

export function normalizeUrl(url: ExternalUrlCandidate): string {
  const normalized = normalizeExternalUrl(url)
  if (normalized) return normalized
  if (startsWithHttpProtocol(url)) return url
  return `https://${url}`
}

/** Open a URL in the system browser. Uses Tauri opener plugin in native mode, window.open in browser. */
export async function openExternalUrl(url: ExternalUrlCandidate): Promise<void> {
  const normalized = normalizeExternalUrl(url)
  if (!normalized) return

  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    try {
      await openUrl(normalized)
    } catch (error) {
      if (isExternalOpenCanceledByUser(error)) return
      throw error
    }
  } else {
    window.open(normalized, '_blank')
  }
}

/** Open a local file path with the system default app (e.g. TextEdit for .json). */
export async function openLocalFile(absolutePath: AbsoluteFilePath, vaultPath?: AbsoluteFilePath): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const args: { path: string; vaultPath?: string } = { path: absolutePath }
    if (vaultPath) args.vaultPath = vaultPath
    await invoke('open_vault_file_external', args)
  }
}

/** Reveal a local file or folder in the system file manager. */
export async function revealLocalPath(absolutePath: AbsoluteFilePath): Promise<void> {
  if (isTauri()) {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(absolutePath)
  }
}

/** Copy a local file or folder path to the system clipboard. */
export async function copyLocalPath(absolutePath: AbsoluteFilePath): Promise<void> {
  await writeClipboardText(absolutePath)
}
