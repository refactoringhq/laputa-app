export type CrossWindowStoreReadReason = 'initial' | 'storage'
type Listener = () => void

interface CrossWindowPersistedStoreOptions<TSnapshot> {
  broadcastChannelName: string
  broadcastMessage: unknown
  emptySnapshot: TSnapshot
  sanitizeStoredValue: (value: unknown, reason: CrossWindowStoreReadReason) => TSnapshot
  storageKey: string
}

export function createCrossWindowPersistedStore<TSnapshot>({
  broadcastChannelName,
  broadcastMessage,
  emptySnapshot,
  sanitizeStoredValue,
  storageKey,
}: CrossWindowPersistedStoreOptions<TSnapshot>) {
  let snapshot = readStoredSnapshot('initial')
  let broadcastChannel: BroadcastChannel | null = null
  const listeners = new Set<Listener>()
  function readStoredSnapshot(reason: CrossWindowStoreReadReason = 'initial'): TSnapshot {
    if (typeof localStorage === 'undefined') return emptySnapshot

    try {
      return sanitizeStoredValue(JSON.parse(localStorage.getItem(storageKey) ?? '{}'), reason)
    } catch {
      return emptySnapshot
    }
  }

  function writeStoredSnapshot(nextSnapshot = snapshot): void {
    if (typeof localStorage === 'undefined') return

    try {
      localStorage.setItem(storageKey, JSON.stringify(nextSnapshot))
    } catch {
      // Cross-window localStorage is a best-effort cache; callers may have a durable backend.
    }
  }

  function notifyListeners(): void {
    for (const listener of listeners) listener()
  }

  function broadcastSnapshot(): void {
    if (typeof BroadcastChannel === 'undefined') return

    broadcastChannel ??= new BroadcastChannel(broadcastChannelName)
    broadcastChannel.postMessage(broadcastMessage)
  }

  function replaceSnapshot(nextSnapshot: TSnapshot): void {
    snapshot = nextSnapshot
    notifyListeners()
  }

  function publishSnapshot(nextSnapshot: TSnapshot): void {
    snapshot = nextSnapshot
    writeStoredSnapshot()
    broadcastSnapshot()
    notifyListeners()
  }

  function syncFromStorage(): void {
    replaceSnapshot(readStoredSnapshot('storage'))
  }

  function ensureCrossWindowSync(): void {
    if (typeof window === 'undefined') return
    window.addEventListener('storage', (event) => {
      if (event.key === storageKey) syncFromStorage()
    })

    if (typeof BroadcastChannel === 'undefined') return
    broadcastChannel ??= new BroadcastChannel(broadcastChannelName)
    broadcastChannel.onmessage = syncFromStorage
  }

  return {
    ensureCrossWindowSync,
    getSnapshot: () => snapshot,
    publishSnapshot,
    replaceSnapshot,
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    writeStoredSnapshot,
  }
}
