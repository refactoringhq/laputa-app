import { convertFileSrc } from '@tauri-apps/api/core'
import { canWritePathToVault } from './vaultPathContainment'

const LOCALHOST_ASSET_URL_PREFIX = 'asset://localhost/'
const HTTP_ASSET_URL_PREFIX = 'http://asset.localhost/'
const GENERIC_ASSET_URL_PREFIX = 'asset://'
const ASSET_URL_PREFIXES = [
  LOCALHOST_ASSET_URL_PREFIX,
  HTTP_ASSET_URL_PREFIX,
  GENERIC_ASSET_URL_PREFIX,
]
const ATTACHMENTS_SEGMENT = '/attachments/'
const RELATIVE_ATTACHMENTS_PREFIX = 'attachments/'
const DOT_RELATIVE_ATTACHMENTS_PREFIX = `./${RELATIVE_ATTACHMENTS_PREFIX}`
const WINDOWS_EXTENDED_PATH_PREFIX = '\\\\?\\'
const WINDOWS_EXTENDED_UNC_PREFIX = '\\\\?\\UNC\\'
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/

type AbsolutePath = string
type AttachmentPath = string
type VaultPath = string

type UrlRequest = {
  url: string
}

type PathRequest = {
  path: string
}

type VaultPathRequest = {
  vaultPath: VaultPath
}

type AttachmentPathRequest = {
  attachmentPath: AttachmentPath
}

export type VaultAttachmentPathRequest = UrlRequest & {
  vaultPath?: VaultPath
}

export type VaultAttachmentUrlRequest = UrlRequest

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function hasUnsafeRelativeSegment({ path }: PathRequest): boolean {
  return path.split(/[\\/]/u).some(segment => segment === '..')
}

function usesWindowsSeparators({ path }: PathRequest): boolean {
  return WINDOWS_DRIVE_PATH_PATTERN.test(path) || path.startsWith('\\\\')
}

function relativePathForVault({
  attachmentPath,
  vaultPath,
}: AttachmentPathRequest & VaultPathRequest): AttachmentPath {
  const normalizedAttachmentPath = normalizePortableAttachmentPath(attachmentPath)
  return usesWindowsSeparators({ path: vaultPath })
    ? normalizedAttachmentPath.replace(/\//g, '\\')
    : normalizedAttachmentPath.replace(/\\/g, '/')
}

function normalizePortableAttachmentPath(path: AttachmentPath): AttachmentPath {
  return path.startsWith(DOT_RELATIVE_ATTACHMENTS_PREFIX) ? path.slice(2) : path
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

function normalizeForComparison(path: AbsolutePath, vaultPath: VaultPath): AbsolutePath {
  const normalizedPath = withoutTrailingSlash(normalizedFilesystemPath(path))
  const normalizedVaultPath = withoutTrailingSlash(normalizedFilesystemPath(vaultPath))
  return WINDOWS_DRIVE_PATH_PATTERN.test(normalizedPath)
    || WINDOWS_DRIVE_PATH_PATTERN.test(normalizedVaultPath)
    ? normalizedPath.toLowerCase()
    : normalizedPath
}

function assetUrlPrefix({ url }: UrlRequest): string | null {
  return ASSET_URL_PREFIXES.find(prefix => url.startsWith(prefix)) ?? null
}

function isRootedPath({ path }: PathRequest): boolean {
  if (path.startsWith('/')) return true
  if (WINDOWS_DRIVE_PATH_PATTERN.test(path)) return true
  return path.startsWith('\\\\')
}

function restoreUnixRoot({ path }: PathRequest): AbsolutePath {
  return isRootedPath({ path }) ? path : `/${path}`
}

function resolveAssetPath({ url }: UrlRequest): AbsolutePath | null {
  const prefix = assetUrlPrefix({ url })
  if (!prefix) return null
  return restoreUnixRoot({ path: safeDecode(url.slice(prefix.length)) })
}

function extractPortableAttachmentPath({ path }: PathRequest): AttachmentPath | null {
  const normalizedPath = normalizedFilesystemPath(path)
  const index = normalizedPath.lastIndexOf(ATTACHMENTS_SEGMENT)
  if (index === -1) return null

  const filename = normalizedPath.slice(index + ATTACHMENTS_SEGMENT.length)
  return filename ? `${RELATIVE_ATTACHMENTS_PREFIX}${filename}` : null
}

function currentVaultAttachmentPath({
  path,
  vaultPath,
}: PathRequest & VaultPathRequest): AttachmentPath | null {
  const normalizedPath = normalizedFilesystemPath(path)
  const normalizedVaultPath = withoutTrailingSlash(normalizedFilesystemPath(vaultPath))
  const attachmentsRoot = `${normalizedVaultPath}/${RELATIVE_ATTACHMENTS_PREFIX}`
  const comparablePath = normalizeForComparison(normalizedPath, vaultPath)
  const comparableRoot = normalizeForComparison(attachmentsRoot, vaultPath)
  if (!comparablePath.startsWith(comparableRoot)) return null

  const filename = normalizedPath.slice(attachmentsRoot.length)
  return filename ? `${RELATIVE_ATTACHMENTS_PREFIX}${filename}` : null
}

function isPathInsideVault({
  path,
  vaultPath,
}: PathRequest & VaultPathRequest): boolean {
  return canWritePathToVault(
    removeWindowsExtendedPrefix(path),
    removeWindowsExtendedPrefix(vaultPath),
  )
}

function resolveRelativeAttachmentPath({
  url,
  vaultPath,
}: UrlRequest & VaultPathRequest): AbsolutePath | null {
  if (!isPortableAttachmentPath({ path: url })) return null

  const attachmentPath = normalizePortableAttachmentPath(safeDecode(url))
  if (hasUnsafeRelativeSegment({ path: attachmentPath })) return null
  return vaultAttachmentPath({ vaultPath, attachmentPath })
}

export function vaultAttachmentPath({
  attachmentPath,
  vaultPath,
}: AttachmentPathRequest & VaultPathRequest): AbsolutePath {
  const separator = usesWindowsSeparators({ path: vaultPath }) ? '\\' : '/'
  const normalizedAttachmentPath = relativePathForVault({ vaultPath, attachmentPath })
  const joiner = vaultPath.endsWith('/') || vaultPath.endsWith('\\') ? '' : separator
  return `${vaultPath}${joiner}${normalizedAttachmentPath}`
}

export function attachmentAssetUrlFromPath({ path }: PathRequest): string {
  return convertFileSrc(path)
}

export function vaultAttachmentAssetUrl({
  attachmentPath,
  vaultPath,
}: AttachmentPathRequest & VaultPathRequest): string {
  return attachmentAssetUrlFromPath({
    path: vaultAttachmentPath({ vaultPath, attachmentPath }),
  })
}

export function isPortableAttachmentPath({ path }: PathRequest): boolean {
  return path.startsWith(RELATIVE_ATTACHMENTS_PREFIX)
    || path.startsWith(DOT_RELATIVE_ATTACHMENTS_PREFIX)
}

export function isTauriAssetUrl({ url }: UrlRequest): boolean {
  return assetUrlPrefix({ url }) !== null
}

export function filesystemPathFromAssetUrl({ url }: UrlRequest): AbsolutePath | null {
  return resolveAssetPath({ url })
}

export function isCurrentVaultAssetUrl({
  url,
  vaultPath,
}: UrlRequest & VaultPathRequest): boolean {
  const path = resolveAssetPath({ url })
  return path ? isPathInsideVault({ path, vaultPath }) : false
}

export function portableAttachmentPathFromCurrentVaultAssetUrl({
  url,
  vaultPath,
}: UrlRequest & VaultPathRequest): AttachmentPath | null {
  const path = resolveAssetPath({ url })
  if (!path || !isPathInsideVault({ path, vaultPath })) return null
  return currentVaultAttachmentPath({ path, vaultPath })
}

export function portableAttachmentPathFromCurrentVaultPath({
  path,
  vaultPath,
}: PathRequest & VaultPathRequest): AttachmentPath | null {
  if (!isPathInsideVault({ path, vaultPath })) return null
  return currentVaultAttachmentPath({ path, vaultPath })
}

export function portableAttachmentPathFromAnyAssetUrl({ url }: UrlRequest): AttachmentPath | null {
  const path = resolveAssetPath({ url })
  return path ? extractPortableAttachmentPath({ path }) : null
}

export function isVaultAttachmentUrl({ url }: VaultAttachmentUrlRequest): boolean {
  const trimmedUrl = url.trim()
  return isPortableAttachmentPath({ path: trimmedUrl })
    || isTauriAssetUrl({ url: trimmedUrl })
}

export function resolveVaultAttachmentPath({
  url,
  vaultPath,
}: VaultAttachmentPathRequest): AbsolutePath | null {
  const trimmedVaultPath = vaultPath?.trim()
  if (!trimmedVaultPath) return null

  const trimmedUrl = url.trim()
  if (!trimmedUrl) return null

  const candidatePath = resolveRelativeAttachmentPath({
    url: trimmedUrl,
    vaultPath: trimmedVaultPath,
  })
    ?? resolveAssetPath({ url: trimmedUrl })
    ?? trimmedUrl

  return isPathInsideVault({ path: candidatePath, vaultPath: trimmedVaultPath }) ? candidatePath : null
}
