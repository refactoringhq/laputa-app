import type { VaultEntry } from '../types'

/**
 * Detects whether the current window is a secondary "note window" (opened via
 * "Open in New Window") by inspecting URL query parameters.
 */

export interface NoteWindowParams {
  notePath: string
  vaultPath: string
  noteTitle: string
}

type NoteWindowPathContext = Pick<NoteWindowParams, 'notePath' | 'vaultPath'>

interface TauriWindowInternals {
  metadata?: { currentWindow?: { label?: string } }
}

const NOTE_WINDOW_STORAGE_PREFIX = 'tolaria:note-window:'
const AI_WORKSPACE_WINDOW_STORAGE_PREFIX = 'tolaria:ai-workspace-window:'
const AI_WORKSPACE_WINDOW_LABEL = 'ai-workspace'
const AI_WORKSPACE_WINDOW_STORAGE_KEY = `${AI_WORKSPACE_WINDOW_STORAGE_PREFIX}${AI_WORKSPACE_WINDOW_LABEL}`

function getCurrentWindowLabel(): string | null {
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriWindowInternals }).__TAURI_INTERNALS__
  const label = internals?.metadata?.currentWindow?.label
  return typeof label === 'string' && label.length > 0 ? label : null
}

function noteWindowStorageKey(label: string): string {
  return `${NOTE_WINDOW_STORAGE_PREFIX}${label}`
}

function isStoredNoteWindowParams(value: Partial<NoteWindowParams>): value is NoteWindowParams {
  if (typeof value.notePath !== 'string') return false
  if (typeof value.vaultPath !== 'string') return false
  return typeof value.noteTitle === 'string'
}

function parseStoredNoteWindowParams(raw: string | null): NoteWindowParams | null {
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<NoteWindowParams>
    if (isStoredNoteWindowParams(parsed)) {
      return {
        notePath: parsed.notePath,
        vaultPath: parsed.vaultPath,
        noteTitle: parsed.noteTitle,
      }
    }
  } catch {
    return null
  }

  return null
}

function getStoredNoteWindowParams(label: string | null): NoteWindowParams | null {
  if (!label) return null

  try {
    return parseStoredNoteWindowParams(localStorage.getItem(noteWindowStorageKey(label)))
  } catch {
    return null
  }
}

function getNoteWindowLabel(params: URLSearchParams): string | null {
  return params.get('windowLabel') ?? getCurrentWindowLabel()
}

export function rememberNoteWindowParams(label: string, params: NoteWindowParams): void {
  try {
    localStorage.setItem(noteWindowStorageKey(label), JSON.stringify(params))
  } catch {
    // Best-effort fallback for Tauri windows that lose their initial URL params.
  }
}

export function rememberAiWorkspaceWindow(): void {
  try {
    localStorage.setItem(AI_WORKSPACE_WINDOW_STORAGE_KEY, 'true')
  } catch {
    // Best-effort fallback for Tauri windows that lose their initial URL params.
  }
}

export function isNoteWindow(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.get('window') === 'note') return true
  return getStoredNoteWindowParams(getCurrentWindowLabel()) !== null
}

export function isAiWorkspaceWindow(): boolean {
  const params = new URLSearchParams(window.location.search)
  if (params.get('window') === 'ai-workspace') return true

  if (getCurrentWindowLabel() !== AI_WORKSPACE_WINDOW_LABEL) return false

  try {
    return localStorage.getItem(AI_WORKSPACE_WINDOW_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function getNoteWindowParams(): NoteWindowParams | null {
  const params = new URLSearchParams(window.location.search)
  if (params.get('window') !== 'note') return getStoredNoteWindowParams(getCurrentWindowLabel())
  const notePath = params.get('path')
  const vaultPath = params.get('vault')
  const noteTitle = params.get('title') ?? 'Untitled'
  if (!notePath || !vaultPath) return getStoredNoteWindowParams(getNoteWindowLabel(params))
  return { notePath, vaultPath, noteTitle }
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '')
}

function stripKnownVaultPrefix({ notePath, vaultPath }: NoteWindowPathContext): string {
  const normalizedPath = trimTrailingSlash(notePath)
  const normalizedVaultPath = trimTrailingSlash(vaultPath)
  const vaultPrefix = `${normalizedVaultPath}/`

  if (normalizedVaultPath && normalizedPath.startsWith(vaultPrefix)) {
    return normalizedPath.slice(vaultPrefix.length)
  }

  const vaultName = normalizedVaultPath.split('/').pop()
  if (vaultName && normalizedPath.startsWith(`${vaultName}/`)) {
    return normalizedPath.slice(vaultName.length + 1)
  }
  if (vaultName) {
    const embeddedVaultPrefix = `/${vaultName}/`
    const embeddedVaultIndex = normalizedPath.indexOf(embeddedVaultPrefix)
    if (embeddedVaultIndex !== -1) {
      return normalizedPath.slice(embeddedVaultIndex + embeddedVaultPrefix.length)
    }
  }

  return normalizedPath.replace(/^\/+/, '')
}

function getVaultRelativeCandidate(vaultName: string | undefined, relativePath: string): string | null {
  if (!vaultName) return null
  if (!relativePath) return null
  if (relativePath.startsWith(`${vaultName}/`)) return null
  return `${vaultName}/${relativePath}`
}

export function getNoteWindowPathCandidates({ notePath, vaultPath }: NoteWindowPathContext): string[] {
  const normalizedPath = trimTrailingSlash(notePath)
  const normalizedVaultPath = trimTrailingSlash(vaultPath)
  const relativePath = stripKnownVaultPrefix({ notePath: normalizedPath, vaultPath: normalizedVaultPath })
  const candidates = new Set<string>([normalizedPath])

  if (normalizedVaultPath) {
    candidates.add(`${normalizedVaultPath}/${relativePath}`)
  }
  if (relativePath !== normalizedPath) {
    candidates.add(relativePath)
  }
  const vaultName = normalizedVaultPath.split('/').pop()
  const vaultRelativeCandidate = getVaultRelativeCandidate(vaultName, relativePath)
  if (vaultRelativeCandidate) candidates.add(vaultRelativeCandidate)
  const withoutLeadingSlash = normalizedPath.replace(/^\/+/, '')
  if (withoutLeadingSlash !== normalizedPath) {
    candidates.add(withoutLeadingSlash)
  }

  return [...candidates]
}

function pathsMatch(leftPath: string, rightPath: string): boolean {
  return leftPath === rightPath
}

function variantsOverlap(left: Set<string>, right: Set<string>): boolean {
  for (const leftVariant of left) {
    for (const rightVariant of right) {
      if (pathsMatch(leftVariant, rightVariant)) {
        return true
      }
    }
  }

  return false
}

export function findNoteWindowEntry(
  entries: VaultEntry[],
  pathContext: NoteWindowPathContext,
): VaultEntry | undefined {
  const targetVariants = new Set(getNoteWindowPathCandidates(pathContext))

  return entries.find((entry) => variantsOverlap(targetVariants, new Set(getNoteWindowPathCandidates({
    notePath: entry.path,
    vaultPath: pathContext.vaultPath,
  }))))
}
