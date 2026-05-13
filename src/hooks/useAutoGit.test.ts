import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoGit } from './useAutoGit'

type AutoGitOptions = Parameters<typeof useAutoGit>[0]

function defaultAutoGitOptions(onCheckpoint: AutoGitOptions['onCheckpoint']): AutoGitOptions {
  return {
    enabled: true,
    idleThresholdSeconds: 1,
    inactiveThresholdSeconds: 1,
    isGitVault: true,
    hasPendingChanges: true,
    hasUnsavedChanges: false,
    onCheckpoint,
  }
}

function renderAutoGit(overrides: Partial<AutoGitOptions> = {}) {
  const onCheckpoint = overrides.onCheckpoint ?? vi.fn().mockResolvedValue(true)
  const hook = renderHook(() => useAutoGit({
    ...defaultAutoGitOptions(onCheckpoint),
    ...overrides,
    onCheckpoint,
  }))

  return { onCheckpoint, ...hook }
}

async function advanceAutoGitBy(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function expectSingleCheckpointPerActivityBurst(
  onCheckpoint: AutoGitOptions['onCheckpoint'],
  recordActivity: () => void,
) {
  await advanceAutoGitBy(1_000)
  expect(onCheckpoint).toHaveBeenCalledTimes(1)

  await advanceAutoGitBy(3_000)
  expect(onCheckpoint).toHaveBeenCalledTimes(1)

  act(() => {
    recordActivity()
  })

  await advanceAutoGitBy(1_000)
  expect(onCheckpoint).toHaveBeenCalledTimes(2)
}

describe('useAutoGit', () => {
  let hasFocus = true

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus)
    hasFocus = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('triggers an idle checkpoint after the configured threshold', async () => {
    const { onCheckpoint } = renderAutoGit({
      idleThresholdSeconds: 3,
      inactiveThresholdSeconds: 2,
    })

    await advanceAutoGitBy(2_999)
    expect(onCheckpoint).not.toHaveBeenCalled()

    await advanceAutoGitBy(1)
    expect(onCheckpoint).toHaveBeenCalledWith('idle')
  })

  it('waits for the app to become inactive before triggering the inactive checkpoint', async () => {
    const { onCheckpoint } = renderAutoGit({
      idleThresholdSeconds: 10,
      inactiveThresholdSeconds: 2,
    })

    hasFocus = false
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
      await vi.advanceTimersByTimeAsync(2_000)
    })

    expect(onCheckpoint).toHaveBeenCalledWith('inactive')
  })

  it('does not trigger while the editor still has unsaved changes', async () => {
    const { onCheckpoint } = renderAutoGit({
      hasUnsavedChanges: true,
    })

    await advanceAutoGitBy(2_000)

    expect(onCheckpoint).not.toHaveBeenCalled()
  })

  it('only triggers once per activity burst until activity is recorded again', async () => {
    const { onCheckpoint, result } = renderAutoGit()
    await expectSingleCheckpointPerActivityBurst(onCheckpoint, result.current.recordActivity)
  })

  it('does not retry a rejected checkpoint for the same activity burst', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onCheckpoint = vi.fn().mockRejectedValue(new Error('Author identity unknown'))
    const { result } = renderAutoGit({
      onCheckpoint,
    })
    await expectSingleCheckpointPerActivityBurst(onCheckpoint, result.current.recordActivity)
    expect(warnSpy).toHaveBeenCalledWith('[git] Auto-commit failed:', expect.any(Error))
  })
})
