import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { importClipDeepLinkFromClipboard } from '../utils/clipDeepLink'

interface ClipDeepLinkHandlerParams {
  addEntry: (entry: VaultEntry) => void
  enabled?: boolean
  openTabWithContent: (entry: VaultEntry, content: string) => void
  reloadVault: () => Promise<unknown> | unknown
  setToastMessage: (message: string) => void
  vaultPath: string
}

interface ClipDeepLinkRegistrationParams {
  getCurrentUrls: () => Promise<string[] | null>
  importUrl: (rawUrl: string) => void
  onOpenUrl: (handler: (urls: string[]) => void) => Promise<() => void>
  onRegistrationError: (error: unknown) => void
}

export function registerClipDeepLinkImports({
  getCurrentUrls,
  importUrl,
  onOpenUrl,
  onRegistrationError,
}: ClipDeepLinkRegistrationParams): () => void {
  let disposed = false
  let unlisten: (() => void) | null = null

  const importUrls = (urls: string[] | null) => {
    if (disposed || !urls) return
    urls.forEach((url) => importUrl(url))
  }

  getCurrentUrls()
    .then(importUrls)
    .catch(onRegistrationError)

  onOpenUrl(importUrls)
    .then((dispose) => {
      if (disposed) {
        dispose()
        return
      }
      unlisten = dispose
    })
    .catch(onRegistrationError)

  return () => {
    disposed = true
    unlisten?.()
  }
}

export function useClipDeepLinkHandler({
  addEntry,
  enabled = true,
  openTabWithContent,
  reloadVault,
  setToastMessage,
  vaultPath,
}: ClipDeepLinkHandlerParams) {
  useEffect(() => {
    if (!enabled || !isTauri()) return

    const importUrl = (rawUrl: string) => {
      void importClipDeepLinkFromClipboard({
        rawUrl,
        vaultPath,
        services: {
          readClipboardText: () => invoke<string>('read_text_from_clipboard'),
          createNoteContent: (path, content, targetVaultPath) => invoke<void>('create_note_content', {
            path,
            content,
            vaultPath: targetVaultPath,
          }),
          reloadVaultEntry: (path, targetVaultPath) => invoke<VaultEntry>('reload_vault_entry', {
            path,
            vaultPath: targetVaultPath,
          }),
          reloadVault,
          addEntry,
          openTabWithContent,
          setToastMessage,
        },
      })
    }

    const cleanup = registerClipDeepLinkImports({
      getCurrentUrls: getCurrent,
      importUrl,
      onOpenUrl,
      onRegistrationError: (error) => {
        console.warn('[clip-deep-link] Failed to register Tolaria URL handler:', error)
      },
    })

    return cleanup
  }, [addEntry, enabled, openTabWithContent, reloadVault, setToastMessage, vaultPath])
}
