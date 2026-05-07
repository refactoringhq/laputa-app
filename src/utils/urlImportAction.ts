import { invoke } from '@tauri-apps/api/core'
import { resolveTypeInstanceDefaults } from '../hooks/useNoteCreation'
import { trackEvent } from '../lib/telemetry'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { ImportNoteFromUrlResult, SidebarSelection, VaultEntry } from '../types'
import { formatUrlImportToast, noteTypeForUrlImport } from './urlImport'

interface CreateNoteFromUrlDeps {
  selection: SidebarSelection
  entries: VaultEntry[]
  vaultPath: string
  addEntry: (entry: VaultEntry) => void
  openTabWithContent: (entry: VaultEntry, content: string) => void
  loadModifiedFiles: () => Promise<unknown> | unknown
  markRecentVaultWrite: (path: string) => void
  recordAutoGitActivity: () => void
  setToastMessage: (message: string) => void
}

interface ImportNoteFromUrlArgs {
  vaultPath: string
  url: string
  noteType: string
  typeDefaults: ReturnType<typeof resolveTypeInstanceDefaults>
}

export async function createNoteFromUrl(url: string, deps: CreateNoteFromUrlDeps): Promise<boolean> {
  const noteType = noteTypeForUrlImport(deps.selection)
  const typeDefaults = resolveTypeInstanceDefaults({ entries: deps.entries, typeName: noteType })

  try {
    const result = await importNoteFromUrl({
      vaultPath: deps.vaultPath,
      url,
      noteType,
      typeDefaults,
    })
    handleUrlImportSuccess(result, noteType, deps)
    return true
  } catch (err) {
    handleUrlImportFailure(err, deps.setToastMessage)
    return false
  }
}

async function importNoteFromUrl(args: ImportNoteFromUrlArgs): Promise<ImportNoteFromUrlResult> {
  const commandArgs: Record<string, unknown> = {
    vaultPath: args.vaultPath,
    url: args.url,
    noteType: args.noteType,
    typeDefaults: args.typeDefaults,
  }
  if (isTauri()) {
    const result = await invoke('import_note_from_url', commandArgs)
    return result as ImportNoteFromUrlResult
  }
  return mockInvoke<ImportNoteFromUrlResult>('import_note_from_url', commandArgs)
}

function handleUrlImportSuccess(
  result: ImportNoteFromUrlResult,
  noteType: string,
  deps: CreateNoteFromUrlDeps,
): void {
  deps.markRecentVaultWrite(result.entry.path)
  deps.addEntry(result.entry)
  deps.openTabWithContent(result.entry, result.content)
  void deps.loadModifiedFiles()
  deps.recordAutoGitActivity()
  trackUrlImportSuccess(result, noteType)
  deps.setToastMessage(formatUrlImportToast(result))
}

function trackUrlImportSuccess(result: ImportNoteFromUrlResult, noteType: string): void {
  trackEvent('note_imported_from_url', {
    provider: 'curl_md',
    status: 'ok',
    inherited_type: noteType === 'Note' ? 0 : 1,
    has_icon: result.entry.icon ? 1 : 0,
    saved_media_count: result.savedMediaCount,
    skipped_media_count: result.skippedMediaCount,
  })
}

function handleUrlImportFailure(err: unknown, setToastMessage: (message: string) => void): void {
  const message = err instanceof Error ? err.message : String(err)
  trackEvent('note_imported_from_url', { provider: 'curl_md', status: 'error' })
  setToastMessage(`Could not import URL: ${message}`)
}
