import { isTauri } from '../mock-tauri'

function parseHttpUrl(candidate: string): URL | null {
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

function startsWithHttpProtocol(url: string): boolean {
  const lowerUrl = url.toLowerCase()
  return lowerUrl.startsWith('http://') || lowerUrl.startsWith('https://')
}

export function normalizeExternalUrl(value: string): string | null {
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

export function isUrlValue(value: string): boolean {
  return normalizeExternalUrl(value) !== null
}

export function normalizeUrl(url: string): string {
  const normalized = normalizeExternalUrl(url)
  if (normalized) return normalized
  if (startsWithHttpProtocol(url)) return url
  return `https://${url}`
}

/** Open a URL in the system browser. Uses Tauri opener plugin in native mode, window.open in browser. */
export async function openExternalUrl(url: string): Promise<void> {
  const normalized = normalizeExternalUrl(url)
  if (!normalized) return

  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(normalized)
  } else {
    window.open(normalized, '_blank')
  }
}

/** Open a local file path with the system default app (e.g. TextEdit for .json). */
export async function openLocalFile(absolutePath: string, vaultPath?: string): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const args: { path: string; vaultPath?: string } = { path: absolutePath }
    if (vaultPath) args.vaultPath = vaultPath
    await invoke('open_vault_file_external', args)
  }
}

/** Reveal a local file or folder in the system file manager. */
export async function revealLocalPath(absolutePath: string): Promise<void> {
  if (isTauri()) {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(absolutePath)
  }
}

/** Copy a local file or folder path to the system clipboard. */
export async function copyLocalPath(absolutePath: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard API is unavailable')
  }

  await navigator.clipboard.writeText(absolutePath)
}
