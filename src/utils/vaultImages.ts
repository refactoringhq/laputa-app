import { isTauri } from '../mock-tauri'
import {
  attachmentAssetUrlFromPath,
  filesystemPathFromAssetUrl,
  isCurrentVaultAssetUrl,
  isPortableAttachmentPath,
  isTauriAssetUrl,
  portableAttachmentPathFromAnyAssetUrl,
  portableAttachmentPathFromCurrentVaultAssetUrl,
  vaultAttachmentAssetUrl,
} from './vaultAttachments'

type Markdown = string
type VaultPath = string
type NotePath = string
type AbsolutePath = string
type MarkdownImageUrl = string

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/
const BACKSLASH_CODE = 92
const MARKDOWN_IMAGE_URL_FORBIDDEN_CHARS = ['\t', '\n', '\r', '"']

interface MarkdownImageToken {
  alt: string
  end: number
  start: number
  title: string
  url: MarkdownImageUrl
}

interface MarkdownImageDestination {
  title: string
  url: MarkdownImageUrl
}

interface ImageUrlContext {
  vaultPath: VaultPath
  notePath?: NotePath
}

interface ImageUrlRequest extends ImageUrlContext {
  url: MarkdownImageUrl
}

interface NoteRelativePathRequest {
  notePath: NotePath
  relativeUrl: MarkdownImageUrl
}

interface NoteDirectoryRelativePathRequest {
  notePath: NotePath
  absolutePath: AbsolutePath
}

interface MarkdownDestinationRequest {
  destination: string
}

interface MarkdownDestinationScanState {
  inTitle: boolean
  parenthesisDepth: number
}

interface UrlOnlyRequest {
  url: MarkdownImageUrl
}

interface PathOnlyRequest {
  path: AbsolutePath
}

interface NotePathRequest {
  notePath: NotePath
}

interface PathSegmentComparisonRequest {
  left: string
  right: string
  caseInsensitive: boolean
}

function rewriteMarkdownImages(
  markdown: Markdown,
  transformUrl: (url: MarkdownImageUrl) => MarkdownImageUrl | null,
): Markdown {
  let rewritten = ''
  let cursor = 0

  while (cursor < markdown.length) {
    const image = nextMarkdownImage(markdown, cursor)
    if (!image) break

    rewritten += markdown.slice(cursor, image.start)
    const nextUrl = transformUrl(image.url)
    rewritten += nextUrl
      ? `![${image.alt}](${nextUrl}${image.title})`
      : markdown.slice(image.start, image.end)
    cursor = image.end
  }

  return rewritten + markdown.slice(cursor)
}

function trailingBackslashCount(markdown: Markdown, index: number): number {
  let cursor = index

  while (cursor > 0) {
    if (markdown.charCodeAt(cursor - 1) !== BACKSLASH_CODE) break
    cursor -= 1
  }

  return index - cursor
}

function isEscaped(markdown: Markdown, index: number): boolean {
  return trailingBackslashCount(markdown, index) % 2 === 1
}

function isTitleQuoteStart(markdown: Markdown, index: number, destinationStart: number): boolean {
  const previous = markdown[index - 1]
  if (previous !== ' ' && previous !== '\t') return false

  return markdown.slice(destinationStart, index).trim().length > 0
}

function handleTitleScanCharacter(state: MarkdownDestinationScanState, char: string): boolean {
  if (!state.inTitle) return false
  if (char === '"') state.inTitle = false
  return true
}

function handleParenthesisScanCharacter(state: MarkdownDestinationScanState, char: string): boolean {
  if (char === '(') {
    state.parenthesisDepth += 1
    return false
  }

  if (char !== ')') return false
  if (state.parenthesisDepth === 0) return true
  state.parenthesisDepth -= 1
  return false
}

function isDestinationClosingParenthesis(
  markdown: Markdown,
  cursor: number,
  destinationStart: number,
  state: MarkdownDestinationScanState,
): boolean {
  const char = markdown[cursor]
  if (isEscaped(markdown, cursor)) return false
  if (handleTitleScanCharacter(state, char)) return false

  if (char === '"' && isTitleQuoteStart(markdown, cursor, destinationStart)) {
    state.inTitle = true
    return false
  }

  return handleParenthesisScanCharacter(state, char)
}

function markdownImageDestinationEnd(markdown: Markdown, destinationStart: number): number | null {
  const state = {
    inTitle: false,
    parenthesisDepth: 0,
  }

  for (let cursor = destinationStart; cursor < markdown.length; cursor += 1) {
    if (isDestinationClosingParenthesis(markdown, cursor, destinationStart, state)) return cursor
  }

  return null
}

function nextMarkdownImage(markdown: Markdown, startIndex: number): MarkdownImageToken | null {
  const start = markdown.indexOf('![', startIndex)
  if (start === -1) return null

  const altEnd = markdown.indexOf('](', start + 2)
  if (altEnd === -1) return nextMarkdownImage(markdown, start + 2)

  const destinationStart = altEnd + 2
  const destinationEnd = markdownImageDestinationEnd(markdown, destinationStart)
  if (destinationEnd === null) return nextMarkdownImage(markdown, start + 2)

  const destinationText = markdown.slice(destinationStart, destinationEnd)
  const destination = parseMarkdownImageDestination({
    destination: destinationText,
  })
  if (!destination) return nextMarkdownImage(markdown, start + 2)
  const alt = markdown.slice(start + 2, altEnd)
  const end = destinationEnd + 1

  return {
    alt,
    end,
    start,
    title: destination.title,
    url: destination.url,
  }
}

function parseMarkdownImageDestination(request: MarkdownDestinationRequest): MarkdownImageDestination | null {
  const { destination } = request
  const titleStart = destination.indexOf(' "')
  const url = titleStart === -1 ? destination : destination.slice(0, titleStart)
  const title = titleStart === -1 ? '' : destination.slice(titleStart)
  if (url.length === 0) return null
  if (MARKDOWN_IMAGE_URL_FORBIDDEN_CHARS.some(char => url.includes(char))) return null
  if (title && !title.endsWith('"')) return null
  return { title, url }
}

function hasUrlScheme(request: UrlOnlyRequest): boolean {
  return URL_SCHEME_PATTERN.test(request.url)
}

function isFilesystemAbsolutePath(request: PathOnlyRequest): boolean {
  return request.path.startsWith('/')
    || WINDOWS_DRIVE_PATH_PATTERN.test(request.path)
    || request.path.startsWith('\\\\')
}

function usesWindowsSeparators(request: PathOnlyRequest): boolean {
  return WINDOWS_DRIVE_PATH_PATTERN.test(request.path) || request.path.startsWith('\\\\')
}

function decodePathUrl(request: UrlOnlyRequest): string {
  try {
    return decodeURI(request.url)
  } catch {
    return request.url
  }
}

function noteDirectoryPath(request: NotePathRequest): AbsolutePath {
  const { notePath } = request
  const index = Math.max(notePath.lastIndexOf('/'), notePath.lastIndexOf('\\'))
  if (index === -1) return '.'
  if (index === 0) return notePath.charAt(0)
  return notePath.slice(0, index)
}

function pathSegments(request: PathOnlyRequest): string[] {
  const { path } = request
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/u, '')
  if (normalized === '') return path.startsWith('/') ? [''] : ['.']
  if (normalized === '/') return ['']
  return normalized.split('/')
}

function popPathSegment(segments: string[]): void {
  const last = segments.at(-1)
  if (!last || last === '' || /^[A-Za-z]:$/.test(last)) return
  if (last === '.') {
    segments[segments.length - 1] = '..'
    return
  }
  if (last === '..') {
    segments.push('..')
    return
  }
  segments.pop()
}

function appendRelativeSegment(segments: string[], segment: string): void {
  if (!segment || segment === '.') return
  if (segment === '..') {
    popPathSegment(segments)
    return
  }
  segments.push(segment)
}

function joinNoteRelativePath(request: NoteRelativePathRequest): AbsolutePath {
  const { notePath, relativeUrl } = request
  const noteDir = noteDirectoryPath({ notePath })
  const segments = pathSegments({ path: noteDir })
  const useBackslash = usesWindowsSeparators({ path: noteDir })

  for (const segment of decodePathUrl({ url: relativeUrl }).replace(/\\/g, '/').split('/')) {
    appendRelativeSegment(segments, segment)
  }

  const joined = segments.join('/') || '.'
  return useBackslash ? joined.replace(/\//g, '\\') : joined
}

function samePathSegment(request: PathSegmentComparisonRequest): boolean {
  const { left, right, caseInsensitive } = request
  return caseInsensitive ? left.toLowerCase() === right.toLowerCase() : left === right
}

function hasCommonSegmentAt(options: {
  leftSegments: string[]
  rightSegments: string[]
  index: number
  caseInsensitive: boolean
}): boolean {
  const { leftSegments, rightSegments, index, caseInsensitive } = options
  const left = leftSegments.at(index)
  const right = rightSegments.at(index)
  if (left === undefined || right === undefined) return false
  return samePathSegment({ left, right, caseInsensitive })
}

function relativePathFromNoteDirectory(request: NoteDirectoryRelativePathRequest): MarkdownImageUrl | null {
  const { notePath, absolutePath } = request
  const noteDir = noteDirectoryPath({ notePath })
  const noteSegments = pathSegments({ path: noteDir })
  const targetSegments = pathSegments({ path: absolutePath })
  const caseInsensitive = usesWindowsSeparators({ path: noteDir })
    || usesWindowsSeparators({ path: absolutePath })
  let common = 0

  while (hasCommonSegmentAt({
    leftSegments: noteSegments,
    rightSegments: targetSegments,
    index: common,
    caseInsensitive,
  })) {
    common += 1
  }

  if (common === 0) return null

  const upSegments = Array.from({ length: noteSegments.length - common }, () => '..')
  const downSegments = targetSegments.slice(common)
  const relative = [...upSegments, ...downSegments].join('/')
  if (!relative) return './'
  return upSegments.length === 0 ? `./${relative}` : relative
}

function resolvePortableAttachmentUrl(request: ImageUrlRequest): MarkdownImageUrl | null {
  const { url, vaultPath } = request
  if (!isPortableAttachmentPath({ path: url })) return null
  return vaultAttachmentAssetUrl({ vaultPath, attachmentPath: decodePathUrl({ url }) })
}

function resolveLegacyAttachmentAssetUrl(request: ImageUrlRequest): MarkdownImageUrl | null {
  const { url, vaultPath } = request
  if (!isTauriAssetUrl({ url })) return null
  if (isCurrentVaultAssetUrl({ url, vaultPath })) return null

  const attachmentPath = portableAttachmentPathFromAnyAssetUrl({ url })
  return attachmentPath ? vaultAttachmentAssetUrl({ vaultPath, attachmentPath }) : null
}

function resolveAbsoluteFilesystemUrl(request: UrlOnlyRequest): MarkdownImageUrl | null {
  const { url } = request
  return isFilesystemAbsolutePath({ path: url })
    ? attachmentAssetUrlFromPath({ path: decodePathUrl({ url }) })
    : null
}

function resolveNoteRelativeUrl(request: ImageUrlRequest): MarkdownImageUrl | null {
  const { url, notePath } = request
  if (!notePath || hasUrlScheme({ url })) return null
  return attachmentAssetUrlFromPath({ path: joinNoteRelativePath({ notePath, relativeUrl: url }) })
}

function resolveImageUrl(request: ImageUrlRequest): MarkdownImageUrl | null {
  return resolveLegacyAttachmentAssetUrl(request)
    ?? resolveAbsoluteFilesystemUrl({ url: request.url })
    ?? resolveNoteRelativeUrl(request)
    ?? resolvePortableAttachmentUrl(request)
}

export function resolveImageUrls(
  markdown: Markdown,
  vaultPath: VaultPath,
  notePath?: NotePath,
): Markdown {
  if (!isTauri() || !vaultPath) return markdown

  return rewriteMarkdownImages(markdown, url => resolveImageUrl({ url, vaultPath, notePath }))
}

function portableCurrentAttachmentPath(request: ImageUrlRequest): MarkdownImageUrl | null {
  return portableAttachmentPathFromCurrentVaultAssetUrl({
    url: request.url,
    vaultPath: request.vaultPath,
  })
}

function portableCurrentVaultImagePath(request: ImageUrlRequest): MarkdownImageUrl | null {
  const { url, vaultPath, notePath } = request
  if (!notePath || !isCurrentVaultAssetUrl({ url, vaultPath })) return null

  const absolutePath = filesystemPathFromAssetUrl({ url })
  return absolutePath ? relativePathFromNoteDirectory({ notePath, absolutePath }) : null
}

function portableFallbackFilesystemPath(request: UrlOnlyRequest): MarkdownImageUrl | null {
  return filesystemPathFromAssetUrl({ url: request.url })
}

function portableImageUrl(request: ImageUrlRequest): MarkdownImageUrl | null {
  if (!isTauriAssetUrl({ url: request.url })) return null
  return portableCurrentAttachmentPath(request)
    ?? portableCurrentVaultImagePath(request)
    ?? portableFallbackFilesystemPath({ url: request.url })
}

export function portableImageUrls(
  markdown: Markdown,
  vaultPath: VaultPath,
  notePath?: NotePath,
): Markdown {
  if (!vaultPath) return markdown

  return rewriteMarkdownImages(markdown, url => portableImageUrl({ url, vaultPath, notePath }))
}
