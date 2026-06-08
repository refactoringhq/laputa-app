import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'
import { isTauri } from '../mock-tauri'
import type { VaultEntry } from '../types'
import { writeClipboardText } from '../utils/clipboardText'
import {
  buildTolariaDeepLinkForEntry,
  relativePathForVaultItem,
  resolveTolariaDeepLink,
  type DeepLinkBuildError,
  type DeepLinkOpenError,
  type DeepLinkVault,
  type ResolvedTolariaDeepLink,
} from '../utils/deepLinks'
import { notePathsMatch } from '../utils/notePathIdentity'
import { cleanupTauriEventListener, type TauriUnlisten } from '../utils/tauriEventCleanup'
import { vaultPathForEntry } from '../utils/workspaces'

interface UseDeepLinksConfig {
  activeEntry: VaultEntry | null
  currentVaultPath: string
  enabled: boolean
  entries: VaultEntry[]
  isVaultContentLoading: boolean
  locale?: AppLocale
  onSelectNote: (entry: VaultEntry) => Promise<void> | void
  onSwitchVault: (path: string) => void
  reloadVault: () => Promise<VaultEntry[]>
  setToastMessage: (message: string) => void
  vaultListLoaded: boolean
  vaults: DeepLinkVault[]
}

interface PendingNavigation {
  absolutePath: string
  relativePath: string
  vault: DeepLinkVault
}

function deepLinkOpenErrorMessage(error: DeepLinkOpenError, locale: AppLocale): string {
  const key = {
    ambiguous_vault: 'deepLinks.error.ambiguousVault',
    invalid_scheme: 'deepLinks.error.invalidScheme',
    malformed_url: 'deepLinks.error.malformedUrl',
    missing_file: 'deepLinks.error.missingFile',
    missing_path: 'deepLinks.error.missingPath',
    missing_vault: 'deepLinks.error.missingVault',
    unavailable_vault: 'deepLinks.error.unavailableVault',
    unknown_vault: 'deepLinks.error.unknownVault',
    unsafe_path: 'deepLinks.error.unsafePath',
  } satisfies Record<DeepLinkOpenError, Parameters<typeof translate>[1]>
  return translate(locale, key[error])
}

function deepLinkBuildErrorMessage(error: DeepLinkBuildError, locale: AppLocale): string {
  const key = {
    outside_vault: 'deepLinks.error.outsideVault',
    unavailable_vault: 'deepLinks.error.unavailableVault',
    unknown_vault: 'deepLinks.error.unknownVault',
    unsafe_path: 'deepLinks.error.unsafePath',
  } satisfies Record<DeepLinkBuildError, Parameters<typeof translate>[1]>
  return translate(locale, key[error])
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function navigationKey(request: PendingNavigation): string {
  return `${request.vault.path}\n${request.relativePath}`
}

function findEntryForDeepLink(
  entries: readonly VaultEntry[],
  request: PendingNavigation,
): VaultEntry | undefined {
  return entries.find((entry) => {
    const relativePath = relativePathForVaultItem({ itemPath: entry.path, vaultPath: request.vault.path })
    return notePathsMatch(relativePath, request.relativePath)
  })
}

function useDeepLinkVaults(vaults: DeepLinkVault[], currentVaultPath: string): DeepLinkVault[] {
  return useMemo(() => {
    if (vaults.some((vault) => notePathsMatch(vault.path, currentVaultPath))) return vaults
    return [...vaults, { label: 'Current Vault', path: currentVaultPath }]
  }, [currentVaultPath, vaults])
}

interface DeepLinkResolverConfig {
  currentVaultPath: string
  enabled: boolean
  knownVaults: DeepLinkVault[]
  locale: AppLocale
  onSwitchVault: (path: string) => void
  pendingUrl: string | null
  setPendingNavigation: (request: PendingNavigation | null) => void
  setPendingUrl: (url: string | null) => void
  setToastMessage: (message: string) => void
  vaultListLoaded: boolean
}

function useDeepLinkResolver({
  currentVaultPath,
  enabled,
  knownVaults,
  locale,
  onSwitchVault,
  pendingUrl,
  setPendingNavigation,
  setPendingUrl,
  setToastMessage,
  vaultListLoaded,
}: DeepLinkResolverConfig) {
  const openResolvedDeepLink = useCallback((request: Extract<ResolvedTolariaDeepLink, { ok: true }>) => {
    const nextNavigation = {
      absolutePath: request.absolutePath,
      relativePath: request.relativePath,
      vault: request.vault,
    }
    setPendingNavigation(nextNavigation)
    if (!notePathsMatch(currentVaultPath, request.vault.path)) {
      onSwitchVault(request.vault.path)
    }
  }, [currentVaultPath, onSwitchVault, setPendingNavigation])

  useEffect(() => {
    if (!enabled || !pendingUrl || !vaultListLoaded) return

    const resolved = resolveTolariaDeepLink({ rawUrl: pendingUrl, vaults: knownVaults })
    setPendingUrl(null)
    if (!resolved.ok) {
      setToastMessage(deepLinkOpenErrorMessage(resolved.error, locale))
      trackEvent('deep_link_opened', { outcome: 'failed', reason: resolved.error })
      return
    }

    openResolvedDeepLink(resolved)
  }, [enabled, knownVaults, locale, openResolvedDeepLink, pendingUrl, setPendingUrl, setToastMessage, vaultListLoaded])
}

interface DeepLinkNavigationConfig {
  currentVaultPath: string
  enabled: boolean
  entries: VaultEntry[]
  isVaultContentLoading: boolean
  locale: AppLocale
  onSelectNote: (entry: VaultEntry) => Promise<void> | void
  pendingNavigation: PendingNavigation | null
  reloadVault: () => Promise<VaultEntry[]>
  setPendingNavigation: (request: PendingNavigation | null) => void
  setToastMessage: (message: string) => void
}

interface DeepLinkEntrySelectionInput {
  entries: VaultEntry[]
  onSelectNote: (entry: VaultEntry) => Promise<void> | void
  pendingNavigation: PendingNavigation
  reloadVault: () => Promise<VaultEntry[]>
}

async function selectDeepLinkEntry({
  entries,
  onSelectNote,
  pendingNavigation,
  reloadVault,
}: DeepLinkEntrySelectionInput): Promise<boolean> {
  const existingEntry = findEntryForDeepLink(entries, pendingNavigation)
  if (existingEntry) {
    await onSelectNote(existingEntry)
    return true
  }

  const freshEntries = await reloadVault()
  const freshEntry = findEntryForDeepLink(freshEntries, pendingNavigation)
  if (!freshEntry) return false

  await onSelectNote(freshEntry)
  return true
}

function readyPendingNavigation({
  currentVaultPath,
  enabled,
  isVaultContentLoading,
  pendingNavigation,
}: Pick<DeepLinkNavigationConfig, 'currentVaultPath' | 'enabled' | 'isVaultContentLoading' | 'pendingNavigation'>): PendingNavigation | null {
  if (!enabled || !pendingNavigation || isVaultContentLoading) return null
  return notePathsMatch(currentVaultPath, pendingNavigation.vault.path) ? pendingNavigation : null
}

function useDeepLinkNavigation({
  currentVaultPath,
  enabled,
  entries,
  isVaultContentLoading,
  locale,
  onSelectNote,
  pendingNavigation,
  reloadVault,
  setPendingNavigation,
  setToastMessage,
}: DeepLinkNavigationConfig) {
  const activeAttemptRef = useRef<string | null>(null)

  useEffect(() => {
    const request = readyPendingNavigation({ currentVaultPath, enabled, isVaultContentLoading, pendingNavigation })
    if (!request) return

    const key = navigationKey(request)
    if (activeAttemptRef.current === key) return
    activeAttemptRef.current = key

    const run = async () => {
      const selected = await selectDeepLinkEntry({ entries, onSelectNote, pendingNavigation: request, reloadVault })
      if (selected) {
        setPendingNavigation(null)
        trackEvent('deep_link_opened', { outcome: 'success' })
        return
      }

      setPendingNavigation(null)
      setToastMessage(deepLinkOpenErrorMessage('missing_file', locale))
      trackEvent('deep_link_opened', { outcome: 'failed', reason: 'missing_file' })
    }

    void run()
      .catch((error) => {
        setPendingNavigation(null)
        setToastMessage(translate(locale, 'deepLinks.error.openFailed', { detail: errorDetail(error) }))
        trackEvent('deep_link_opened', { outcome: 'failed', reason: 'open_failed' })
      })
      .finally(() => {
        if (activeAttemptRef.current === key) activeAttemptRef.current = null
      })
  }, [
    currentVaultPath,
    enabled,
    entries,
    isVaultContentLoading,
    locale,
    onSelectNote,
    pendingNavigation,
    reloadVault,
    setToastMessage,
    setPendingNavigation,
  ])
}

function usePendingDeepLinkUrl(setPendingUrl: (url: string | null) => void) {
  return useCallback((url: string) => {
    setPendingUrl(url)
  }, [setPendingUrl])
}

function latestDeepLinkUrl(urls: string[] | null | undefined): string | null {
  return urls?.at(-1) ?? urls?.[0] ?? null
}

function queueLatestDeepLinkUrl(
  urls: string[] | null | undefined,
  setPendingUrl: (url: string | null) => void,
) {
  const url = latestDeepLinkUrl(urls)
  if (url) setPendingUrl(url)
}

interface DeepLinkListenerState {
  disposed: boolean
}

async function installTauriDeepLinkListener({
  listenerState,
  setPendingUrl,
}: {
  listenerState: DeepLinkListenerState
  setPendingUrl: (url: string | null) => void
}): Promise<() => void> {
  const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link')
  queueLatestDeepLinkUrl(await getCurrent(), (url) => {
    if (!listenerState.disposed) setPendingUrl(url)
  })

  const stopListening = await onOpenUrl((urls) => {
    queueLatestDeepLinkUrl(urls, setPendingUrl)
  })
  if (!listenerState.disposed) return stopListening

  cleanupTauriEventListener(stopListening)
  return () => {}
}

function useTauriDeepLinkListener({
  enabled,
  setPendingUrl,
}: {
  enabled: boolean
  setPendingUrl: (url: string | null) => void
}) {
  useEffect(() => {
    if (!enabled || !isTauri()) return undefined

    const listenerState = { disposed: false }
    let unlisten: TauriUnlisten | null = null

    installTauriDeepLinkListener({ listenerState, setPendingUrl })
      .then((stopListening) => {
        unlisten = stopListening
      })
      .catch((error) => {
        console.warn('[deep-link] Failed to install listener:', error)
      })

    return () => {
      listenerState.disposed = true
      cleanupTauriEventListener(unlisten)
    }
  }, [enabled, setPendingUrl])
}

function useDeepLinkTestBridge({
  enabled,
  openDeepLink,
}: {
  enabled: boolean
  openDeepLink: (url: string) => void
}) {
  useEffect(() => {
    if (!enabled) return undefined
    window.__laputaTest = {
      ...window.__laputaTest,
      openDeepLink,
    }
    return () => {
      if (window.__laputaTest?.openDeepLink === openDeepLink) {
        delete window.__laputaTest.openDeepLink
      }
    }
  }, [enabled, openDeepLink])
}

interface DeepLinkCopyActionsConfig {
  activeEntry: VaultEntry | null
  currentVaultPath: string
  entries: VaultEntry[]
  knownVaults: DeepLinkVault[]
  locale: AppLocale
  setToastMessage: (message: string) => void
}

function useDeepLinkCopyActions({
  activeEntry,
  currentVaultPath,
  entries,
  knownVaults,
  locale,
  setToastMessage,
}: DeepLinkCopyActionsConfig) {
  const copyEntryDeepLink = useCallback((entry: VaultEntry) => {
    const vaultPath = vaultPathForEntry(entry, currentVaultPath)
    const result = buildTolariaDeepLinkForEntry({ entry, vaultPath, vaults: knownVaults })
    if (!result.ok) {
      setToastMessage(deepLinkBuildErrorMessage(result.error, locale))
      trackEvent('deep_link_copied', { outcome: 'failed', reason: result.error })
      return
    }

    void writeClipboardText(result.url)
      .then(() => {
        setToastMessage(translate(locale, 'deepLinks.copied'))
        trackEvent('deep_link_copied', { outcome: 'success' })
      })
      .catch((error) => {
        setToastMessage(translate(locale, 'deepLinks.error.copyFailed', { detail: errorDetail(error) }))
        trackEvent('deep_link_copied', { outcome: 'failed', reason: 'clipboard_failed' })
      })
  }, [currentVaultPath, knownVaults, locale, setToastMessage])

  const copyPathDeepLink = useCallback((path: string) => {
    const entry = entries.find((candidate) => notePathsMatch(candidate.path, path))
    if (!entry) {
      setToastMessage(deepLinkOpenErrorMessage('missing_file', locale))
      return
    }
    copyEntryDeepLink(entry)
  }, [copyEntryDeepLink, entries, locale, setToastMessage])

  const copyActiveDeepLink = useCallback(() => {
    if (!activeEntry) return
    copyEntryDeepLink(activeEntry)
  }, [activeEntry, copyEntryDeepLink])

  return {
    copyActiveDeepLink,
    copyEntryDeepLink,
    copyPathDeepLink,
  }
}

export function useDeepLinks({
  activeEntry,
  currentVaultPath,
  enabled,
  entries,
  isVaultContentLoading,
  locale = 'en',
  onSelectNote,
  onSwitchVault,
  reloadVault,
  setToastMessage,
  vaultListLoaded,
  vaults,
}: UseDeepLinksConfig) {
  const knownVaults = useDeepLinkVaults(vaults, currentVaultPath)
  const [pendingUrl, setPendingUrl] = useState<string | null>(null)
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)

  useDeepLinkResolver({
    currentVaultPath,
    enabled,
    knownVaults,
    locale,
    onSwitchVault,
    pendingUrl,
    setPendingNavigation,
    setPendingUrl,
    setToastMessage,
    vaultListLoaded,
  })
  useDeepLinkNavigation({
    currentVaultPath,
    enabled,
    entries,
    isVaultContentLoading,
    locale,
    onSelectNote,
    pendingNavigation,
    reloadVault,
    setPendingNavigation,
    setToastMessage,
  })

  const openDeepLink = usePendingDeepLinkUrl(setPendingUrl)
  useTauriDeepLinkListener({ enabled, setPendingUrl })
  useDeepLinkTestBridge({ enabled, openDeepLink })

  return {
    ...useDeepLinkCopyActions({
      activeEntry,
      currentVaultPath,
      entries,
      knownVaults,
      locale,
      setToastMessage,
    }),
    openDeepLink,
  }
}
