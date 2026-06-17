import type { VaultEntry } from '../types'
import { notePathsMatch } from './notePathIdentity'

function serializedEntry(entry: VaultEntry): string {
  return JSON.stringify(entry)
}

export function shouldReplaceSyncedTabEntry(currentEntry: VaultEntry, nextEntry: VaultEntry): boolean {
  if (currentEntry === nextEntry) return false
  if (!notePathsMatch(currentEntry.path, nextEntry.path)) return true
  return serializedEntry(currentEntry) !== serializedEntry(nextEntry)
}
