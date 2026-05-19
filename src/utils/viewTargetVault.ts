interface ViewCreationVaultPathOptions {
  editingRootPath?: string
  fallbackVaultPath: string
  graphDefaultWorkspacePath: string
  multiWorkspaceEnabled: boolean
}

function usablePath(path: string | null | undefined): string | null {
  const trimmed = path?.trim()
  return trimmed ? trimmed : null
}

export function viewCreationVaultPath({
  editingRootPath,
  fallbackVaultPath,
  graphDefaultWorkspacePath,
  multiWorkspaceEnabled,
}: ViewCreationVaultPathOptions): string {
  return usablePath(editingRootPath)
    ?? (multiWorkspaceEnabled ? usablePath(graphDefaultWorkspacePath) : null)
    ?? fallbackVaultPath
}
