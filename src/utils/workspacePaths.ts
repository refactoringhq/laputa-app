export function workspaceStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function isNonBlankWorkspacePath(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function workspacePathOrEmpty(value: unknown): string {
  return isNonBlankWorkspacePath(value) ? value : ''
}

export function uniqueNonBlankWorkspacePaths(paths: readonly unknown[]): string[] {
  return [...new Set(paths.filter(isNonBlankWorkspacePath))]
}
