import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'

const ASSET_URL_PREFIX = 'asset://localhost/'
const HTTP_ASSET_URL_PREFIX = 'http://asset.localhost/'
const ASSET_URL_PREFIXES = [ASSET_URL_PREFIX, HTTP_ASSET_URL_PREFIX]
const ATTACHMENTS_SEGMENT = '/attachments/'
const RELATIVE_ATTACHMENTS_PREFIX = 'attachments/'
const WINDOWS_EXTENDED_PATH_PREFIX = '\\\\?\\'
const WINDOWS_EXTENDED_UNC_PREFIX = '\\\\?\\UNC\\'
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/

type Markdown = string
type VaultPath = string
type AttachmentPath = string
type AbsolutePath = string
type MarkdownImageUrl = string

// Matches markdown image syntax: ![alt](url) or ![alt](url "title").
const MD_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s"]+)(\s+"[^"]*")?\)/g

function assetUrl(path: AbsolutePath): MarkdownImageUrl {
  return convertFileSrc(path)
}

function usesWindowsSeparators(path: string): boolean {
  return WINDOWS_DRIVE_PATH_PATTERN.test(path) || path.startsWith('\\\\')
}

function relativePathForVault(vaultPath: VaultPath, attachmentPath: AttachmentPath): AttachmentPath {
  return usesWindowsSeparators(vaultPath)
    ? attachmentPath.replace(/\//g, '\\')
    : attachmentPath.replace(/\\/g, '/')
}

function vaultAttachmentPath(vaultPath: VaultPath, attachmentPath: AttachmentPath): AbsolutePath {
  const separator = usesWindowsSeparators(vaultPath) ? '\\' : '/'
  const normalizedAttachmentPath = relativePathForVault(vaultPath, attachmentPath)
  const joiner = vaultPath.endsWith('/') || vaultPath.endsWith('\\') ? '' : separator
  return `${vaultPath}${joiner}${normalizedAttachmentPath}`
}

function removeWindowsExtendedPrefix(path: AbsolutePath): AbsolutePath {
  if (path.startsWith(WINDOWS_EXTENDED_UNC_PREFIX)) {
    return `\\\\${path.slice(WINDOWS_EXTENDED_UNC_PREFIX.length)}`
  }
  if (path.startsWith(WINDOWS_EXTENDED_PATH_PREFIX)) {
    return path.slice(WINDOWS_EXTENDED_PATH_PREFIX.length)
  }
  return path
}

function normalizedFilesystemPath(path: AbsolutePath): AbsolutePath {
  return removeWindowsExtendedPrefix(path).replace(/\\/g, '/')
}

function withoutTrailingSlash(path: AbsolutePath): AbsolutePath {
  return path.replace(/\/+$/, '')
}

function extractAttachmentPath(absolutePath: AbsolutePath): AttachmentPath | null {
  const normalizedPath = normalizedFilesystemPath(absolutePath)
  const index = normalizedPath.lastIndexOf(ATTACHMENTS_SEGMENT)
  if (index === -1) return null

  const filename = normalizedPath.slice(index + ATTACHMENTS_SEGMENT.length)
  return filename ? `${RELATIVE_ATTACHMENTS_PREFIX}${filename}` : null
}

function assetUrlPrefix(url: MarkdownImageUrl): string | null {
  return ASSET_URL_PREFIXES.find(prefix => url.startsWith(prefix)) ?? null
}

function decodeAssetPath(url: MarkdownImageUrl): AbsolutePath {
  const prefix = assetUrlPrefix(url)
  return prefix ? decodeURIComponent(url.slice(prefix.length)) : ''
}

function isAssetUrl(url: MarkdownImageUrl): boolean {
  return assetUrlPrefix(url) !== null
}

function isCurrentVaultAsset(url: MarkdownImageUrl, vaultPath: VaultPath): boolean {
  const absolutePath = withoutTrailingSlash(normalizedFilesystemPath(decodeAssetPath(url)))
  const normalizedVaultPath = withoutTrailingSlash(normalizedFilesystemPath(vaultPath))
  return absolutePath === normalizedVaultPath || absolutePath.startsWith(`${normalizedVaultPath}/`)
}

function currentVaultAttachmentPath(url: MarkdownImageUrl, vaultPath: VaultPath): AttachmentPath | null {
  const absolutePath = normalizedFilesystemPath(decodeAssetPath(url))
  const normalizedVaultPath = withoutTrailingSlash(normalizedFilesystemPath(vaultPath))
  const attachmentsPrefix = `${normalizedVaultPath}/${RELATIVE_ATTACHMENTS_PREFIX}`
  if (!absolutePath.startsWith(attachmentsPrefix)) return null

  const filename = absolutePath.slice(attachmentsPrefix.length)
  return filename ? `${RELATIVE_ATTACHMENTS_PREFIX}${filename}` : null
}

function rewriteMarkdownImages(
  markdown: Markdown,
  transformUrl: (url: MarkdownImageUrl) => MarkdownImageUrl | null,
): Markdown {
  return markdown.replace(MD_IMAGE_PATTERN, (match, alt, url, title = '') => {
    const nextUrl = transformUrl(url)
    return nextUrl ? `![${alt}](${nextUrl}${title})` : match
  })
}

export function resolveImageUrls(markdown: Markdown, vaultPath: VaultPath): Markdown {
  if (!isTauri() || !vaultPath) return markdown

  return rewriteMarkdownImages(markdown, (url) => {
    if (url.startsWith(RELATIVE_ATTACHMENTS_PREFIX)) {
      return assetUrl(vaultAttachmentPath(vaultPath, url))
    }

    if (!isAssetUrl(url) || isCurrentVaultAsset(url, vaultPath)) {
      return null
    }

    const attachmentPath = extractAttachmentPath(decodeAssetPath(url))
    return attachmentPath ? assetUrl(vaultAttachmentPath(vaultPath, attachmentPath)) : null
  })
}

export function portableImageUrls(markdown: Markdown, vaultPath: VaultPath): Markdown {
  if (!vaultPath) return markdown

  return rewriteMarkdownImages(markdown, (url) => {
    if (!isAssetUrl(url)) return null

    return currentVaultAttachmentPath(url, vaultPath)
  })
}
