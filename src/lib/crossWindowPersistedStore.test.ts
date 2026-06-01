import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCrossWindowPersistedStore } from './crossWindowPersistedStore'

const STORAGE_KEY = 'tolaria:test-cross-window-store'
const CHANNEL_NAME = 'tolaria-test-cross-window-store'

interface TestSnapshot {
  value: string
}

class LocalStorageMock implements Storage {
  private readonly store = new Map<string, string>()

  get length() {
    return this.store.size
  }

  clear() {
    this.store.clear()
  }

  getItem(key: string) {
    return this.store.get(key) ?? null
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
}

class BroadcastChannelMock {
  static channels: BroadcastChannelMock[] = []

  onmessage: ((event: MessageEvent<unknown>) => void) | null = null

  constructor(readonly name: string) {
    BroadcastChannelMock.channels.push(this)
  }

  postMessage(message: unknown) {
    for (const channel of BroadcastChannelMock.channels) {
      if (channel === this || channel.name !== this.name) continue
      channel.onmessage?.(new MessageEvent('message', { data: message }))
    }
  }
}

function createTestStore() {
  return createCrossWindowPersistedStore<TestSnapshot>({
    broadcastChannelName: CHANNEL_NAME,
    broadcastMessage: { type: 'test-updated' },
    emptySnapshot: { value: '' },
    sanitizeStoredValue: (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { value: '' }
      const candidate = value as Partial<TestSnapshot>
      return typeof candidate.value === 'string' ? { value: candidate.value } : { value: '' }
    },
    storageKey: STORAGE_KEY,
  })
}

describe('createCrossWindowPersistedStore', () => {
  beforeEach(() => {
    BroadcastChannelMock.channels = []
    vi.stubGlobal('localStorage', new LocalStorageMock())
    vi.stubGlobal('BroadcastChannel', BroadcastChannelMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hydrates and sanitizes persisted snapshots', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ value: 'persisted', ignored: true }))

    const store = createTestStore()

    expect(store.getSnapshot()).toEqual({ value: 'persisted' })
  })

  it('syncs from storage events and notifies subscribers', () => {
    const store = createTestStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.ensureCrossWindowSync()

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ value: 'external' }))
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))

    expect(store.getSnapshot()).toEqual({ value: 'external' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('broadcasts local publishes to sibling stores through localStorage', () => {
    const firstStore = createTestStore()
    const secondStore = createTestStore()
    const secondListener = vi.fn()
    firstStore.ensureCrossWindowSync()
    secondStore.ensureCrossWindowSync()
    secondStore.subscribe(secondListener)

    firstStore.publishSnapshot({ value: 'published' })

    expect(secondStore.getSnapshot()).toEqual({ value: 'published' })
    expect(secondListener).toHaveBeenCalledTimes(1)
  })
})
