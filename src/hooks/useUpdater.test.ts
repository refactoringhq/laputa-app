import { renderHook, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useUpdater } from './useUpdater'
import {
  clearRestartRequiredAfterUpdate,
  isRestartRequiredAfterUpdate,
} from '../lib/appUpdater'

vi.mock('../mock-tauri', () => ({
  isTauri: vi.fn(() => false),
}))

const mockOpenExternalUrl = vi.fn()
vi.mock('../utils/url', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternalUrl(...args),
}))

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  Channel: class {
    onmessage: (response: unknown) => void

    constructor(onmessage?: (response: unknown) => void) {
      this.onmessage = onmessage ?? (() => {})
    }
  },
}))

import { isTauri } from '../mock-tauri'

interface AppUpdateMetadata {
  currentVersion: string
  version: string
  date?: string
  body?: string
}

type DownloadArgs = {
  releaseChannel: string
  expectedVersion: string
  onEvent: {
    onmessage: (
      response:
        | { event: 'Started'; data: { contentLength?: number } }
        | { event: 'Progress'; data: { chunkLength: number } }
        | { event: 'Finished' },
    ) => void
  }
}

function makeUpdate(overrides: Partial<AppUpdateMetadata> = {}): AppUpdateMetadata {
  return {
    currentVersion: '2026.4.15',
    version: '2026.4.16',
    body: 'Bug fixes and improvements',
    ...overrides,
  }
}

function installInvokeHandlers({
  checkResult = null,
  downloadImpl,
}: {
  checkResult?: AppUpdateMetadata | null | Error
  downloadImpl?: (args: DownloadArgs) => Promise<void>
}) {
  mockInvoke.mockImplementation((command: string, args?: unknown) => {
    if (command === 'check_for_app_update') {
      if (checkResult instanceof Error) return Promise.reject(checkResult)
      return Promise.resolve(checkResult)
    }

    if (command === 'download_and_install_app_update') {
      if (downloadImpl) return downloadImpl(args as DownloadArgs)
      return Promise.resolve(null)
    }

    return Promise.resolve(null)
  })
}

function renderUpdater(releaseChannel: string) {
  return renderHook(() => useUpdater(releaseChannel))
}

async function performManualCheck(
  releaseChannel: string,
  checkResult: AppUpdateMetadata | null | Error,
) {
  vi.mocked(isTauri).mockReturnValue(true)
  installInvokeHandlers({ checkResult })

  const hook = renderUpdater(releaseChannel)
  let outcome: string | undefined

  await act(async () => {
    outcome = await hook.result.current.actions.checkForUpdates()
  })

  return { result: hook.result, outcome }
}

async function advanceAutoCheck() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500)
  })
}

describe('useUpdater', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    clearRestartRequiredAfterUpdate()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts in idle state', () => {
    vi.mocked(isTauri).mockReturnValue(false)

    const { result } = renderUpdater('stable')

    expect(result.current.status).toEqual({ state: 'idle' })
  })

  it('does not check for updates when not running in Tauri', async () => {
    vi.mocked(isTauri).mockReturnValue(false)

    renderUpdater('stable')
    await advanceAutoCheck()

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('checks for stable updates after the startup delay', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    installInvokeHandlers({ checkResult: null })

    renderUpdater('stable')
    await advanceAutoCheck()

    expect(mockInvoke).toHaveBeenCalledWith('check_for_app_update', {
      releaseChannel: 'stable',
    })
  })

  it('transitions to available when an alpha update is found', async () => {
    const { result } = await performManualCheck(
      'alpha',
      makeUpdate({ version: '2026.4.16-alpha.3' }),
    )

    expect(result.current.status).toEqual({
      state: 'available',
      version: '2026.4.16-alpha.3',
      displayVersion: 'Alpha 2026.4.16.3',
      notes: 'Bug fixes and improvements',
    })

    expect(mockInvoke).toHaveBeenCalledWith('check_for_app_update', {
      releaseChannel: 'alpha',
    })
  })

  it('returns up-to-date when no update is available', async () => {
    const { result, outcome } = await performManualCheck('stable', null)

    expect(outcome).toEqual({ kind: 'up-to-date' })
    expect(result.current.status).toEqual({ state: 'idle' })
  })

  it('shows checking state while a manual update check is in flight', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    let resolveCheck: (value: AppUpdateMetadata | null) => void = () => {}
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'check_for_app_update') {
        return new Promise<AppUpdateMetadata | null>((resolve) => {
          resolveCheck = resolve
        })
      }
      return Promise.resolve(null)
    })

    const { result } = renderUpdater('stable')

    let checkPromise: Promise<unknown> | null = null
    await act(async () => {
      checkPromise = result.current.actions.checkForUpdates()
      await Promise.resolve()
    })

    expect(result.current.status).toEqual({ state: 'checking' })

    await act(async () => {
      resolveCheck(null)
      expect(await checkPromise).toEqual({ kind: 'up-to-date' })
    })

    expect(result.current.status).toEqual({ state: 'idle' })
  })

  it('returns available and sets status when an update exists', async () => {
    const { result, outcome } = await performManualCheck(
      'stable',
      makeUpdate({ body: undefined }),
    )

    expect(outcome).toEqual({
      kind: 'available',
      version: '2026.4.16',
      displayVersion: '2026.4.16',
    })
    expect(result.current.status).toEqual({
      state: 'available',
      version: '2026.4.16',
      displayVersion: '2026.4.16',
      notes: undefined,
    })
  })

  it('strips stable prerelease suffixes from the display version', async () => {
    const { result } = await performManualCheck(
      'stable',
      makeUpdate({ version: '2026.4.16-stable.1' }),
    )

    expect(result.current.status).toEqual({
      state: 'available',
      version: '2026.4.16-stable.1',
      displayVersion: '2026.4.16',
      notes: 'Bug fixes and improvements',
    })
  })

  it('returns error when the update check fails', async () => {
    const { result, outcome } = await performManualCheck(
      'stable',
      new Error('network error'),
    )

    expect(outcome).toEqual({
      kind: 'error',
      message: 'Could not check for updates: network error',
    })
    expect(console.warn).toHaveBeenCalledWith('[updater] Failed to check for updates')
    expect(result.current.status).toEqual({ state: 'error' })
  })

  it('dismiss resets the banner state', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    installInvokeHandlers({ checkResult: makeUpdate() })

    const { result } = renderUpdater('stable')

    await act(async () => {
      await result.current.actions.checkForUpdates()
    })

    act(() => {
      result.current.actions.dismiss()
    })

    expect(result.current.status).toEqual({ state: 'idle' })
  })

  it('openReleaseNotes opens the release notes page', () => {
    vi.mocked(isTauri).mockReturnValue(false)

    const { result } = renderUpdater('stable')

    act(() => {
      result.current.actions.openReleaseNotes()
    })

    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      'https://refactoringhq.github.io/tolaria/'
    )
  })

  it('downloads and installs the available update with progress', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    installInvokeHandlers({
      checkResult: makeUpdate(),
      downloadImpl: async (args) => {
        expect(args.releaseChannel).toBe('stable')
        expect(args.expectedVersion).toBe('2026.4.16')
        args.onEvent.onmessage({ event: 'Started', data: { contentLength: 1000 } })
        args.onEvent.onmessage({ event: 'Progress', data: { chunkLength: 500 } })
        args.onEvent.onmessage({ event: 'Progress', data: { chunkLength: 500 } })
        args.onEvent.onmessage({ event: 'Finished' })
      },
    })

    const { result } = renderUpdater('stable')

    await act(async () => {
      await result.current.actions.checkForUpdates()
    })

    await act(async () => {
      await result.current.actions.startDownload()
    })

    expect(result.current.status).toEqual({
      state: 'ready',
      version: '2026.4.16',
      displayVersion: '2026.4.16',
    })
    expect(isRestartRequiredAfterUpdate()).toBe(true)
  })

  it('transitions to error when download fails', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    installInvokeHandlers({
      checkResult: makeUpdate(),
      downloadImpl: async () => {
        throw new Error('download failed')
      },
    })

    const { result } = renderUpdater('stable')

    await act(async () => {
      await result.current.actions.checkForUpdates()
    })

    await act(async () => {
      await result.current.actions.startDownload()
    })

    expect(console.warn).toHaveBeenCalledWith('[updater] Download failed')
    expect(result.current.status).toEqual({ state: 'error' })
  })
})
