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

type RecentWritesProps = {
  vaultPath: string
  vaultPaths?: string[]
}

type WatcherBatchScenario = {
  events: Array<{ vaultPath: string; paths: string[] }>
  expectedPaths: string[]
  vaultPath: string
  vaultPaths?: string[]
}

async function expectBatchedVaultChanges(scenario: WatcherBatchScenario) {
  const onVaultChanged = vi.fn()
  renderHook(() => useVaultWatcher({
    vaultPath: scenario.vaultPath,
    vaultPaths: scenario.vaultPaths,
    onVaultChanged,
  }))

  await settleWatcherSubscription()
  expect(mocks.listener).toBeDefined()

  for (const event of scenario.events) {
    emitVaultChanged(event)
  }

  expect(onVaultChanged).not.toHaveBeenCalled()
  await flushWatcherDebounce()

  expect(onVaultChanged).toHaveBeenCalledWith(scenario.expectedPaths)
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

  it('filters recent app-owned writes across mounted vault roots', () => {
    const { result } = renderHook(() => useRecentVaultWrites({
      vaultPath: '/vault-a',
      vaultPaths: ['/vault-a', '/vault-b'],
      now: () => 1000,
    }))

    act(() => {
      result.current.markInternalWrite('/vault-b/notes/self.md')
    })

    expect(result.current.filterExternalPaths([
      '/vault-a/notes/external.md',
      '/vault-b/notes/self.md',
    ])).toEqual(['/vault-a/notes/external.md'])
  })

  it('filters recent app-owned writes for tilde-mounted vault roots', () => {
    const { result } = renderHook(() => useRecentVaultWrites({
      vaultPath: '/Users/luca/Workspace/laputa',
      vaultPaths: ['/Users/luca/Workspace/laputa', '~/Workspace/refactoring-vault'],
      now: () => 1000,
    }))

    act(() => {
      result.current.markInternalWrite('/Users/luca/Workspace/refactoring-vault/notes/self.md')
    })

    expect(result.current.filterExternalPaths([
      '/Users/luca/Workspace/laputa/notes/external.md',
      '/Users/luca/Workspace/refactoring-vault/notes/self.md',
    ])).toEqual(['/Users/luca/Workspace/laputa/notes/external.md'])
  })

  it.each([
    {
      description: 'the active vault changes',
      initialProps: { vaultPath: '/vault-a' },
      markedPath: '/vault-a/note.md',
      nextProps: { vaultPath: '/vault-b' },
      expectedPath: '/vault-a/note.md',
    },
    {
      description: 'the mounted vault root set changes',
      initialProps: { vaultPath: '/vault-a', vaultPaths: ['/vault-a', '/vault-b'] },
      markedPath: '/vault-b/note.md',
      nextProps: { vaultPath: '/vault-a', vaultPaths: ['/vault-a'] },
      expectedPath: '/vault-b/note.md',
    },
  ])('clears recent writes when $description', ({ initialProps, markedPath, nextProps, expectedPath }) => {
    const { result, rerender } = renderHook(
      ({ vaultPath, vaultPaths }: RecentWritesProps) => useRecentVaultWrites({ vaultPath, vaultPaths, now: () => 1000 }),
      { initialProps },
    )

    act(() => {
      result.current.markInternalWrite(markedPath)
    })
    rerender(nextProps)

    expect(result.current.filterExternalPaths([expectedPath])).toEqual([expectedPath])
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

  it('starts a native watcher for every mounted vault root', async () => {
    renderHook(() => useVaultWatcher({
      vaultPath: '/vault-a',
      vaultPaths: ['/vault-a', '/vault-b', '/vault-a/'],
      onVaultChanged: vi.fn(),
    }))

    await settleWatcherSubscription()
    expect(mocks.listen).toHaveBeenCalledWith(VAULT_CHANGED_EVENT, expect.any(Function))
    expect(mocks.invoke).toHaveBeenCalledWith('start_vault_watcher', { path: '/vault-a' })
    expect(mocks.invoke).toHaveBeenCalledWith('start_vault_watcher', { path: '/vault-b' })
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'start_vault_watcher')).toHaveLength(2)
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

  it.each([
    {
      description: 'the active vault',
      vaultPath: '/vault',
      events: [
        { vaultPath: '/vault', paths: ['notes/a.md'] },
        { vaultPath: '/vault', paths: ['/vault/notes/b.md'] },
      ],
      expectedPaths: ['/vault/notes/a.md', '/vault/notes/b.md'],
    },
    {
      description: 'every watched vault root',
      vaultPath: '/vault-a',
      vaultPaths: ['/vault-a', '/vault-b'],
      events: [
        { vaultPath: '/vault-a', paths: ['notes/a.md'] },
        { vaultPath: '/vault-b', paths: ['notes/b.md'] },
      ],
      expectedPaths: ['/vault-a/notes/a.md', '/vault-b/notes/b.md'],
    },
  ])('batches changed paths from $description', expectBatchedVaultChanges)

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
