import type { VaultProviderType } from './vaultProviders'

export type ProviderAvailability = 'available' | 'degraded' | 'unavailable'
export type ProviderSyncState = 'not_applicable' | 'unknown' | 'syncing_or_delayed' | 'stable'

export interface ProviderStatus {
  availability: ProviderAvailability
  syncState: ProviderSyncState
  message: string | null
}

export type ProviderStatusListener = (status: ProviderStatus) => void

const DEFAULT_LOCAL_STATUS: ProviderStatus = {
  availability: 'available',
  syncState: 'not_applicable',
  message: null,
}

const DEFAULT_ICLOUD_STATUS: ProviderStatus = {
  availability: 'available',
  syncState: 'unknown',
  message: null,
}

export function currentStatus(providerType: VaultProviderType): ProviderStatus {
  return providerType === 'icloud-drive' ? { ...DEFAULT_ICLOUD_STATUS } : { ...DEFAULT_LOCAL_STATUS }
}

export function subscribeStatus(
  providerType: VaultProviderType,
  listener: ProviderStatusListener,
): () => void {
  if (providerType === 'local-folder') {
    // Local folder provider has no dynamic status changes
    return () => {}
  }

  // iCloud provider: best-effort status updates
  // For the first implementation, we check filesystem accessibility periodically
  let cancelled = false
  const intervalId = setInterval(() => {
    if (cancelled) return
    // In future: check iCloud-specific signals
    // For now, just re-emit current healthy status
    listener({
      availability: 'available',
      syncState: 'unknown',
      message: null,
    })
  }, 30_000)

  return () => {
    cancelled = true
    clearInterval(intervalId)
  }
}

export function isWriteBlocked(status: ProviderStatus): boolean {
  return status.availability === 'unavailable'
}
