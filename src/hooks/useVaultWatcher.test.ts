import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VAULT_CHANGED_EVENT,
  VAULT_WATCHER_DEBOUNCE_MS,
  normalizeWatchPath,
  resolveChangedPath,
  useRecentVaultWrites,
  useVaultWatcher,
} from './useVaultWatcher'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  listen: vi.fn(),
  listener: undefined as ((event: { payload: { vaultPath: string; paths: string[] } }) => void) | undefined,
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}))

vi.mock('../mock-tauri', () => ({
  isTauri: mocks.isTauri,
}))

function emitVaultChanged(payload: { vaultPath: string; paths: string[] }) {
  act(() => {
    mocks.listener?.({ payload })
  })
}

async function flushWatcherDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(VAULT_WATCHER_DEBOUNCE_MS)
    await Promise.resolve()
  })
}

async function settleWatcherSubscription() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('watch path helpers', () => {
  it('normalizes slashes and private tmp aliases', () => {
    expect(normalizeWatchPath('/private/tmp/vault//')).toBe('/tmp/vault')
    expect(normalizeWatchPath('C:\\Users\\Luca\\Vault')).toBe('C:/Users/Luca/Vault')
  })

  it('resolves relative watcher paths against the active vault', () => {
    expect(resolveChangedPath({ path: 'notes/day.md', vaultPath: '/vault' })).toBe('/vault/notes/day.md')
    expect(resolveChangedPath({ path: '/vault/notes/day.md', vaultPath: '/vault' })).toBe('/vault/notes/day.md')
  })
})

describe('useRecentVaultWrites', () => {
  it('filters recent app-owned writes but keeps later external changes', () => {
    let now = 1000
    const { result } = renderHook(() => useRecentVaultWrites({ vaultPath: '/vault', now: () => now }))

    act(() => {
      result.current.markInternalWrite('/vault/notes/self.md')
    })

    expect(result.current.filterExternalPaths([
      '/vault/notes/self.md',
      '/vault/notes/external.md',
    ])).toEqual(['/vault/notes/external.md'])

    now += 5000
    expect(result.current.filterExternalPaths(['/vault/notes/self.md'])).toEqual(['/vault/notes/self.md'])
  })

  it('clears recent writes when the active vault changes', () => {
    const { result, rerender } = renderHook(
      ({ vaultPath }) => useRecentVaultWrites({ vaultPath, now: () => 1000 }),
      { initialProps: { vaultPath: '/vault-a' } },
    )

    act(() => {
      result.current.markInternalWrite('/vault-a/note.md')
    })
    rerender({ vaultPath: '/vault-b' })

    expect(result.current.filterExternalPaths(['/vault-a/note.md'])).toEqual(['/vault-a/note.md'])
  })
})

describe('useVaultWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.invoke.mockReset()
    mocks.isTauri.mockReset()
    mocks.listen.mockReset()
    mocks.unlisten.mockReset()
    mocks.listener = undefined
    mocks.isTauri.mockReturnValue(true)
    mocks.invoke.mockResolvedValue(undefined)
    mocks.listen.mockImplementation((_event: string, listener: typeof mocks.listener) => {
      mocks.listener = listener
      return Promise.resolve(mocks.unlisten)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not start a watcher outside Tauri', () => {
    mocks.isTauri.mockReturnValue(false)

    renderHook(() => useVaultWatcher({
      vaultPath: '/vault',
      onVaultChanged: vi.fn(),
    }))

    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.listen).not.toHaveBeenCalled()
  })

  it('starts, subscribes, and stops the native watcher', async () => {
    const { unmount } = renderHook(() => useVaultWatcher({
      vaultPath: '/vault',
      onVaultChanged: vi.fn(),
    }))

    await settleWatcherSubscription()
    expect(mocks.listen).toHaveBeenCalledWith(VAULT_CHANGED_EVENT, expect.any(Function))
    expect(mocks.invoke).toHaveBeenCalledWith('start_vault_watcher', { path: '/vault' })

    unmount()

    await settleWatcherSubscription()
    expect(mocks.unlisten).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('stop_vault_watcher')
  })

  it('swallows stale native watcher unlisten failures and still stops the watcher', async () => {
    mocks.unlisten.mockImplementationOnce(() => {
      throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')")
    })

    const { unmount } = renderHook(() => useVaultWatcher({
      vaultPath: '/vault',
      onVaultChanged: vi.fn(),
    }))

    await settleWatcherSubscription()

    expect(() => unmount()).not.toThrow()
    await settleWatcherSubscription()
    expect(mocks.unlisten).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('stop_vault_watcher')
  })

  it('keeps listener replacement stable when vault paths churn', async () => {
    mocks.unlisten.mockImplementationOnce(() => {
      throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')")
    })

    const { rerender } = renderHook(
      ({ vaultPath }) => useVaultWatcher({ vaultPath, onVaultChanged: vi.fn() }),
      { initialProps: { vaultPath: '/vault-a' } },
    )

    await settleWatcherSubscription()

    expect(() => rerender({ vaultPath: '/vault-b' })).not.toThrow()
    await settleWatcherSubscription()

    expect(mocks.listen).toHaveBeenCalledTimes(2)
    expect(mocks.unlisten).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('start_vault_watcher', { path: '/vault-a' })
    expect(mocks.invoke).toHaveBeenCalledWith('start_vault_watcher', { path: '/vault-b' })
    expect(mocks.invoke).toHaveBeenCalledWith('stop_vault_watcher')
  })

  it('batches changed paths for the active vault', async () => {
    const onVaultChanged = vi.fn()
    renderHook(() => useVaultWatcher({ vaultPath: '/vault', onVaultChanged }))

    await settleWatcherSubscription()
    expect(mocks.listener).toBeDefined()
    emitVaultChanged({ vaultPath: '/vault', paths: ['notes/a.md'] })
    emitVaultChanged({ vaultPath: '/vault', paths: ['/vault/notes/b.md'] })

    expect(onVaultChanged).not.toHaveBeenCalled()
    await flushWatcherDebounce()

    expect(onVaultChanged).toHaveBeenCalledWith(['/vault/notes/a.md', '/vault/notes/b.md'])
  })

  it('ignores watcher events for other vaults', async () => {
    const onVaultChanged = vi.fn()
    renderHook(() => useVaultWatcher({ vaultPath: '/vault', onVaultChanged }))

    await settleWatcherSubscription()
    expect(mocks.listener).toBeDefined()
    emitVaultChanged({ vaultPath: '/other', paths: ['/other/note.md'] })
    await flushWatcherDebounce()

    expect(onVaultChanged).not.toHaveBeenCalled()
  })

  it('lets callers suppress app-owned writes before refreshing', async () => {
    const onVaultChanged = vi.fn()
    renderHook(() => useVaultWatcher({
      vaultPath: '/vault',
      onVaultChanged,
      filterChangedPaths: (paths) => paths.filter((path) => path.endsWith('external.md')),
    }))

    await settleWatcherSubscription()
    expect(mocks.listener).toBeDefined()
    emitVaultChanged({ vaultPath: '/vault', paths: ['self.md', 'external.md'] })
    await flushWatcherDebounce()

    expect(onVaultChanged).toHaveBeenCalledWith(['/vault/external.md'])
  })
})
