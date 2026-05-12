import type { VaultEntry } from '../types'

export interface ClipDeepLink {
  path: string
  title: string | null
}

export type ClipDeepLinkImportResult = 'ignored' | 'rejected' | 'imported'

export interface ClipDeepLinkImportServices {
  readClipboardText: () => Promise<string>
  createNoteContent: (...args: [string, string, string]) => Promise<void>
  reloadVaultEntry: (...args: [string, string]) => Promise<VaultEntry>
  reloadVault: () => Promise<unknown>
  addEntry: (...args: [VaultEntry]) => void
  openTabWithContent: (...args: [VaultEntry, string]) => void
  setToastMessage: (...args: [string]) => void
}

export interface ClipDeepLinkImportParams {
  rawUrl: string
  vaultPath: string
  services: ClipDeepLinkImportServices
}

function isVaultRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\')) return false
  if (/^[A-Za-z]:[\\/]/.test(path)) return false
  const parts = path.split(/[\\/]+/)
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
}

const BODY_QUERY_PARAMS = ['body', 'content', 'html', 'markdown']

function hasInlineBodyParam(searchParams: URLSearchParams): boolean {
  return BODY_QUERY_PARAMS.some((param) => searchParams.has(param))
}

export function parseClipDeepLink(rawUrl: string): ClipDeepLink | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'tolaria:' || url.hostname !== 'clip' || url.pathname !== '/new') return null
  if (url.searchParams.get('v') !== '1') return null
  if (url.searchParams.get('clipboard') !== '1') return null
  if (hasInlineBodyParam(url.searchParams)) return null

  const path = url.searchParams.get('path')?.trim() ?? ''
  if (!isVaultRelativePath(path)) return null

  return {
    path,
    title: url.searchParams.get('title'),
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  const message = String(error).trim()
  return message || 'unknown error'
}

export async function importClipDeepLinkFromClipboard({
  rawUrl,
  vaultPath,
  services,
}: ClipDeepLinkImportParams): Promise<ClipDeepLinkImportResult> {
  const clip = parseClipDeepLink(rawUrl)
  if (!clip) return 'ignored'

  if (!vaultPath.trim()) {
    services.setToastMessage('Open a vault before importing a clip')
    return 'rejected'
  }

  try {
    const content = await services.readClipboardText()
    if (!content.trim()) {
      services.setToastMessage('Clip clipboard is empty — capture cancelled')
      return 'rejected'
    }

    await services.createNoteContent(clip.path, content, vaultPath)
    const entry = await services.reloadVaultEntry(clip.path, vaultPath)
    services.addEntry(entry)
    await services.reloadVault()
    services.openTabWithContent(entry, content)
    const importedTitle = entry.title.trim()
      ? entry.title
      : clip.title?.trim()
        ? clip.title
        : clip.path
    services.setToastMessage(`Imported clip “${importedTitle}”`)
    return 'imported'
  } catch (error) {
    services.setToastMessage(`Failed to import clip: ${errorMessage(error)}`)
    return 'rejected'
  }
}
