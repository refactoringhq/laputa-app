function normalizeVaultContainmentPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function tildeRootSuffix(path: string): string | null {
  if (path === '~') return ''
  return path.startsWith('~/') ? path.slice(1) : null
}

function expandTildeRootFromTarget(targetPath: string, rootPath: string): string {
  const suffix = tildeRootSuffix(rootPath)
  if (suffix === null || suffix === '') return rootPath
  const suffixIndex = targetPath.indexOf(suffix)
  return suffixIndex > 0 ? `${targetPath.slice(0, suffixIndex)}${suffix}` : rootPath
}

function compareVaultContainmentPath(path: string, vaultPath: string): [string, string] {
  const normalizedPath = normalizeVaultContainmentPath(path)
  const normalizedVaultPath = expandTildeRootFromTarget(
    normalizedPath,
    normalizeVaultContainmentPath(vaultPath),
  )
  const hasWindowsDrive = /^[a-z]:/i.test(normalizedPath) || /^[a-z]:/i.test(normalizedVaultPath)
  return hasWindowsDrive
    ? [normalizedPath.toLowerCase(), normalizedVaultPath.toLowerCase()]
    : [normalizedPath, normalizedVaultPath]
}

export function isPathInsideVaultRoot(path: string, vaultPath: string): boolean {
  const trimmedVaultPath = vaultPath.trim()
  if (!trimmedVaultPath) return true
  const [targetPath, rootPath] = compareVaultContainmentPath(path, trimmedVaultPath)
  if (!rootPath || !targetPath) return false
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}/`)
}

export function canWritePathToVault(path: string, vaultPath: string | readonly string[]): boolean {
  if (typeof vaultPath !== 'string') {
    return vaultPath.some((candidate) => canWritePathToVault(path, candidate))
  }
  return isPathInsideVaultRoot(path, vaultPath)
}
