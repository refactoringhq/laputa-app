import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'

export interface NoteFileIdentity {
  path: string
  modifiedAt: number | null
  fileSize: number | null
}

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

export async function captureFileIdentity(path: string, vaultPath: string): Promise<NoteFileIdentity> {
  try {
    const identity = await tauriCall<NoteFileIdentity>('get_note_file_identity', { path, vaultPath })
    return identity
  } catch {
    return { path, modifiedAt: null, fileSize: null }
  }
}

export function hasFileIdentityChanged(
  openIdentity: NoteFileIdentity,
  currentIdentity: NoteFileIdentity,
): boolean {
  if (openIdentity.modifiedAt === null || currentIdentity.modifiedAt === null) {
    return false // Can't determine, assume safe
  }
  if (openIdentity.modifiedAt !== currentIdentity.modifiedAt) return true
  if (openIdentity.fileSize !== currentIdentity.fileSize) return true
  return false
}

export function buildRecoveryFilename(originalPath: string): string {
  const lastSlash = originalPath.lastIndexOf('/')
  const dir = lastSlash >= 0 ? originalPath.slice(0, lastSlash + 1) : ''
  const filename = lastSlash >= 0 ? originalPath.slice(lastSlash + 1) : originalPath
  const dotIndex = filename.lastIndexOf('.')
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename
  const ext = dotIndex > 0 ? filename.slice(dotIndex) : '.md'
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `${dir}${stem}-recovered-${timestamp}${ext}`
}
