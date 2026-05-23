import { useEffect, useRef } from 'react'
/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars -- Callback type parameters document the deep-link service contract. */
import { invoke } from '@tauri-apps/api/core'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import type { AppLocale } from '../lib/i18n'
import { importClipDeepLinkFromClipboard, type ClipDeepLinkImportResult } from '../utils/clipDeepLink'

interface ClipDeepLinkHandlerParams {
  addEntry: (...args: [VaultEntry]) => void
  enabled?: boolean
  locale: AppLocale
  openTabWithContent: (...args: [VaultEntry, string]) => void
  reloadVault: () => Promise<unknown>
  setToastMessage: (...args: [string]) => void
  vaultPath: string
}

type ClipDeepLinkOpenHandler = (...args: [string[]]) => void

interface ClipDeepLinkRegistrationParams {
  getCurrentUrls: () => Promise<string[] | null>
  handledCurrentUrls?: Set<string>
  importUrl: (...args: [string]) => void | Promise<unknown>
  onOpenUrl: (...args: [ClipDeepLinkOpenHandler]) => Promise<() => void>
  onRegistrationError: (...args: [unknown]) => void
}

export function registerClipDeepLinkImports({
  getCurrentUrls,
  handledCurrentUrls,
  importUrl,
  onOpenUrl,
  onRegistrationError,
}: ClipDeepLinkRegistrationParams): () => void {
  let disposed = false
  let unlisten: (() => void) | null = null

  function importUrls(urls: string[] | null): void {
    if (disposed || !urls) return
    urls.forEach((url) => {
      importUrl(url)
    })
  }

  function importCurrentUrls(urls: string[] | null): void {
    if (disposed || !urls) return
    urls.forEach((url) => {
      if (handledCurrentUrls?.has(url)) return
      handledCurrentUrls?.add(url)
      void Promise.resolve(importUrl(url))
        .then((result) => {
          if (result !== 'imported') {
            handledCurrentUrls?.delete(url)
          }
        })
        .catch((error) => {
          handledCurrentUrls?.delete(url)
          onRegistrationError(error)
        })
    })
  }

  getCurrentUrls()
    .then(importCurrentUrls)
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
  locale,
  openTabWithContent,
  reloadVault,
  setToastMessage,
  vaultPath,
}: ClipDeepLinkHandlerParams) {
  const handledCurrentUrlsRef = useRef(new Set<string>())
  const localeRef = useRef(locale)

  useEffect(() => {
    localeRef.current = locale
  }, [locale])

  useEffect(() => {
    if (!enabled || !isTauri()) return

    function importUrl(rawUrl: string): Promise<ClipDeepLinkImportResult> {
      return importClipDeepLinkFromClipboard({
        locale: localeRef.current,
        rawUrl,
        vaultPath,
        services: {
          readClipboardText: () => invoke<string>('read_text_from_clipboard'),
          createNoteContent: (path, content, targetVaultPath) => invoke('create_note_content', {
            path,
            content,
            vaultPath: targetVaultPath,
          }) as Promise<void>,
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
      handledCurrentUrls: handledCurrentUrlsRef.current,
      importUrl,
      onOpenUrl,
      onRegistrationError: (error) => {
        console.warn('[clip-deep-link] Failed to register Tolaria URL handler:', error)
      },
    })

    return cleanup
  }, [addEntry, enabled, openTabWithContent, reloadVault, setToastMessage, vaultPath])
}
