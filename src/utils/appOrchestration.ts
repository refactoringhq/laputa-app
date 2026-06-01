import type { ModifiedFile, SidebarSelection } from '../types'
import type { AiWorkspaceWindowContext } from './openAiWorkspaceWindow'

export const ACTIVE_EDITOR_SURFACE_SELECTOR = '.editor__blocknote-container, .raw-editor-codemirror'

export function isActiveElementInsideEditorSurface(): boolean {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return false
  return Boolean(activeElement.closest(ACTIVE_EDITOR_SURFACE_SELECTOR))
}

export function isTextEditingElementFocused(): boolean {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return false
  return activeElement.tagName === 'INPUT'
    || activeElement.tagName === 'TEXTAREA'
    || activeElement.isContentEditable
    || activeElement.closest('[contenteditable="true"]') !== null
}

export function runNativeTextHistoryCommand(command: 'undo' | 'redo'): boolean {
  if (!isTextEditingElementFocused()) return false
  return document.execCommand(command)
}

function modifiedFileKey(file: ModifiedFile): string {
  return `${file.vaultPath ?? ''}\0${file.relativePath}\0${file.status}`
}

export function activeVaultModifiedFiles(files: ModifiedFile[], vaultPath: string): ModifiedFile[] {
  return files.map((file) => ({ ...file, vaultPath: file.vaultPath ?? vaultPath }))
}

export function mergeModifiedFiles(...groups: ModifiedFile[][]): ModifiedFile[] {
  const byKey = new Map<string, ModifiedFile>()
  for (const group of groups) {
    for (const file of group) {
      byKey.set(modifiedFileKey(file), file)
    }
  }
  return [...byKey.values()]
}

export function shouldPreferOnboardingVaultPath(
  onboardingState: { status: string; vaultPath?: string },
  vaults: Array<{ path: string }>,
): onboardingState is { status: 'ready'; vaultPath: string } {
  return onboardingState.status === 'ready'
    && typeof onboardingState.vaultPath === 'string'
    && onboardingState.vaultPath.length > 0
    && !vaults.some((vault) => vault.path === onboardingState.vaultPath)
}

export function canCustomizeColumnsForSelection(
  selection: SidebarSelection,
  explicitOrganizationEnabled: boolean,
): boolean {
  if (selection.kind === 'view') return true
  if (selection.kind !== 'filter') return false
  if (selection.filter === 'all') return true
  return explicitOrganizationEnabled && selection.filter === 'inbox'
}

export function aiWorkspaceWindowContextForPath(resolvedPath: string): AiWorkspaceWindowContext {
  return {
    vaultPath: resolvedPath,
    vaultPaths: resolvedPath ? [resolvedPath] : [],
  }
}
