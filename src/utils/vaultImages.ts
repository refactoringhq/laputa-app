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
const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

type Markdown = string
type VaultPath = string
type NotePath = string
type AttachmentPath = string
type AbsolutePath = string
type MarkdownImageUrl = string
type RelativeUrl = string

// Matches markdown image syntax: ![alt](url) or ![alt](url "title").
// URL group is non-greedy so a trailing ` "title"` (when present) wins the match
// — that lets URLs contain raw spaces while still recognizing optional titles.
const MD_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)"]+?)(\s+"[^"]*")?\)/g

function assetUrl(path: AbsolutePath): MarkdownImageUrl {
  return convertFileSrc(path)
}

function usesWindowsSeparators(path: string): boolean {
  return WINDOWS_DRIVE_PATH_PATTERN.test(path) || path.startsWith('\\\\')
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || WINDOWS_DRIVE_PATH_PATTERN.test(path) || path.startsWith('\\\\')
}

function hasUrlScheme(url: string): boolean {
  return URL_SCHEME_PATTERN.test(url)
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

function noteDirectoryPath(notePath: NotePath): AbsolutePath {
  const idx = Math.max(notePath.lastIndexOf('/'), notePath.lastIndexOf('\\'))
  if (idx <= 0) return notePath
  return notePath.slice(0, idx)
}

function decodeRelativeUrl(url: RelativeUrl): RelativeUrl {
  // CommonMark allows URL-encoded characters; tolerate malformed input.
  try {
    return decodeURI(url)
  } catch {
    return url
  }
}

function joinNoteRelativePath(noteDir: AbsolutePath, relativeUrl: RelativeUrl): AbsolutePath {
  const useBackslash = usesWindowsSeparators(noteDir)
  const decoded = decodeRelativeUrl(relativeUrl)
  const noteDirNormalized = withoutTrailingSlash(noteDir.replace(/\\/g, '/'))
  const relativeNormalized = decoded.replace(/\\/g, '/')
  const dirSegments = noteDirNormalized.split('/')
  for (const seg of relativeNormalized.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (dirSegments.length > 1) dirSegments.pop()
      continue
    }
    dirSegments.push(seg)
  }
  const joined = dirSegments.join('/')
  return useBackslash ? joined.replace(/\//g, '\\') : joined
}

function relativeFromNoteDirectory(noteDir: AbsolutePath, absolutePath: AbsolutePath): RelativeUrl | null {
  const noteDirNormalized = withoutTrailingSlash(normalizedFilesystemPath(noteDir))
  const absNormalized = normalizedFilesystemPath(absolutePath)

  if (absNormalized.startsWith(`${noteDirNormalized}/`)) {
    return `./${absNormalized.slice(noteDirNormalized.length + 1)}`
  }

  const dirSegs = noteDirNormalized.split('/')
  const absSegs = absNormalized.split('/')
  let common = 0
  while (
    common < dirSegs.length &&
    common < absSegs.length &&
    dirSegs[common] === absSegs[common]
  ) common++
  if (common === 0) return null

  const ups = '../'.repeat(dirSegs.length - common)
  const downs = absSegs.slice(common).join('/')
  return `${ups}${downs}`
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

function noteRelativeFromAssetUrl(url: MarkdownImageUrl, notePath: NotePath): RelativeUrl | null {
  const absolutePath = decodeAssetPath(url)
  if (!absolutePath) return null
  return relativeFromNoteDirectory(noteDirectoryPath(notePath), absolutePath)
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

export function resolveImageUrls(
  markdown: Markdown,
  vaultPath: VaultPath,
  notePath?: NotePath,
): Markdown {
  if (!isTauri() || !vaultPath) return markdown

  return rewriteMarkdownImages(markdown, (url) => {
    if (url.startsWith(RELATIVE_ATTACHMENTS_PREFIX)) {
      return assetUrl(vaultAttachmentPath(vaultPath, url))
    }

    if (isAssetUrl(url)) {
      if (isCurrentVaultAsset(url, vaultPath)) return null
      const attachmentPath = extractAttachmentPath(decodeAssetPath(url))
      return attachmentPath ? assetUrl(vaultAttachmentPath(vaultPath, attachmentPath)) : null
    }

    if (hasUrlScheme(url)) return null

    if (isAbsolutePath(url)) {
      return assetUrl(decodeRelativeUrl(url))
    }

    if (notePath) {
      return assetUrl(joinNoteRelativePath(noteDirectoryPath(notePath), url))
    }

    return null
  })
}

export function portableImageUrls(
  markdown: Markdown,
  vaultPath: VaultPath,
  notePath?: NotePath,
): Markdown {
  if (!vaultPath) return markdown

  return rewriteMarkdownImages(markdown, (url) => {
    if (!isAssetUrl(url)) return null

    const attachmentPath = currentVaultAttachmentPath(url, vaultPath)
    if (attachmentPath) return attachmentPath

    if (notePath) {
      return noteRelativeFromAssetUrl(url, notePath)
    }

    return null
  })
}
