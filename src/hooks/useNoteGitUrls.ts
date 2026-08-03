import { useCallback, useMemo } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { translate, type AppLocale } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { GitRemoteStatus, VaultEntry } from '../types'
import { writeClipboardText } from '../utils/clipboardText'
import { vaultPathForEntry } from '../utils/workspaces'

interface UseNoteGitUrlsConfig {
  currentVaultPath: string
  locale?: AppLocale
  remoteStatusForRepository: (path: string) => GitRemoteStatus | null
  setToastMessage: (message: string) => void
}

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hasRemote(remoteStatus: GitRemoteStatus | null): boolean {
  return remoteStatus?.hasRemote === true
}

async function loadNoteGitUrl(vaultPath: string, path: string): Promise<string | null> {
  return tauriCall<string | null>('git_file_url', { vaultPath, path })
}

export function useNoteGitUrls({
  currentVaultPath,
  locale = 'en',
  remoteStatusForRepository,
  setToastMessage,
}: UseNoteGitUrlsConfig) {
  const canCopyEntryGitUrl = useCallback((entry: VaultEntry) => (
    hasRemote(remoteStatusForRepository(vaultPathForEntry(entry, currentVaultPath)))
  ), [currentVaultPath, remoteStatusForRepository])

  const copyEntryGitUrl = useCallback((entry: VaultEntry) => {
    const vaultPath = vaultPathForEntry(entry, currentVaultPath)
    if (!hasRemote(remoteStatusForRepository(vaultPath))) return

    void loadNoteGitUrl(vaultPath, entry.path)
      .then((url) => {
        if (!url) {
          setToastMessage(translate(locale, 'noteGitUrls.error.unavailable'))
          trackEvent('note_git_url_copied', { outcome: 'failed', reason: 'unavailable' })
          return
        }

        return writeClipboardText(url).then(() => {
          setToastMessage(translate(locale, 'noteGitUrls.copied'))
          trackEvent('note_git_url_copied', { outcome: 'success' })
        })
      })
      .catch((error: unknown) => {
        setToastMessage(translate(locale, 'noteGitUrls.error.copyFailed', { detail: errorDetail(error) }))
        trackEvent('note_git_url_copied', { outcome: 'failed', reason: 'copy_failed' })
      })
  }, [currentVaultPath, locale, remoteStatusForRepository, setToastMessage])

  return useMemo(() => ({
    canCopyEntryGitUrl,
    copyEntryGitUrl,
  }), [canCopyEntryGitUrl, copyEntryGitUrl])
}
