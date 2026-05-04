export type NotePath = string
export type VaultPath = string
export type VaultRelativePath = string

type PathLike = NotePath | null | undefined
type ItemWithNotePath = { path: NotePath }

function stripWindowsExtendedPathPrefix(path: NotePath): NotePath {
  return path
    .replace(/^\\\\\?\\UNC\\/iu, '//')
    .replace(/^\\\\\?\\/u, '')
}

export function normalizeNotePathSeparators(path: NotePath): NotePath {
  return stripWindowsExtendedPathPrefix(path).replaceAll('\\', '/')
}

export function normalizeNotePathForIdentity(path: NotePath): NotePath {
  return normalizeNotePathSeparators(path)
    .replace(/^\/private\/tmp(?=\/|$)/u, '/tmp')
    .replace(/\/+$/u, '')
}

export function normalizeNotePathForCollision(path: NotePath): NotePath {
  return normalizeNotePathForIdentity(path).toLocaleLowerCase()
}

export function notePathsMatch(leftPath: PathLike, rightPath: PathLike): boolean {
  if (!leftPath || !rightPath) return false
  return normalizeNotePathForIdentity(leftPath) === normalizeNotePathForIdentity(rightPath)
}

export function notePathsCollide(leftPath: PathLike, rightPath: PathLike): boolean {
  if (!leftPath || !rightPath) return false
  return normalizeNotePathForCollision(leftPath) === normalizeNotePathForCollision(rightPath)
}

export function findByNotePath<T extends ItemWithNotePath>(items: T[], path: PathLike): T | undefined {
  if (!path) return undefined
  return items.find((item) => notePathsMatch(item.path, path))
}

export function findByCollidingNotePath<T extends ItemWithNotePath>(items: T[], path: PathLike): T | undefined {
  if (!path) return undefined
  return items.find((item) => notePathsCollide(item.path, path))
}

export function notePathFilename(path: NotePath): string {
  const normalized = normalizeNotePathSeparators(path).replace(/\/+$/u, '')
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized
}

export function normalizeVaultRelativePath(path: VaultRelativePath): VaultRelativePath {
  return normalizeNotePathSeparators(path.trim()).replace(/^\/+|\/+$/gu, '')
}

export function vaultRelativePathLabel(path: VaultRelativePath): string {
  const normalized = normalizeVaultRelativePath(path)
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized
}

export function joinVaultPath(vaultPath: VaultPath, relativePath: VaultRelativePath): NotePath {
  const root = vaultPath.replace(/[\\/]+$/u, '') || '/'
  const child = normalizeVaultRelativePath(relativePath)
  if (!child) return root
  return root === '/' ? `/${child}` : `${root}/${child}`
}
