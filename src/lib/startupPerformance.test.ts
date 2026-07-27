import { beforeEach, describe, expect, it, vi } from 'vitest'

const analytics = vi.hoisted(() => ({
  reconciled: vi.fn(),
  usable: vi.fn(),
}))
const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../mock-tauri', () => ({ isTauri: () => true }))
vi.mock('./productAnalytics', () => ({
  trackStartupActiveVaultUsable: analytics.usable,
  trackStartupBackgroundReconciled: analytics.reconciled,
}))

describe('startup performance telemetry', () => {
  beforeEach(() => {
    vi.resetModules()
    performance.clearMarks()
    analytics.reconciled.mockReset()
    analytics.usable.mockReset()
    invoke.mockReset()
    invoke.mockImplementation((command: string) => Promise.resolve(
      command === 'get_startup_elapsed_ms' ? 10 : { elapsed_ms: 10 },
    ))
  })

  it('records the warm-start target and emits each milestone once', async () => {
    const startup = await import('./startupPerformance')

    startup.markStartupPhase('react_shell')
    startup.recordActiveVaultUsable('snapshot', 42)
    startup.recordActiveVaultUsable('scan', 7)
    startup.recordBackgroundReconciled(43)
    startup.recordBackgroundReconciled(44)
    await vi.waitFor(() => expect(analytics.usable).toHaveBeenCalledOnce())

    expect(startup.STARTUP_TARGETS_MS.activeVaultUsable).toBe(800)
    expect(analytics.usable).toHaveBeenCalledWith(expect.objectContaining({
      activeVaultEntryCount: 42,
      source: 'snapshot',
      targetMs: 800,
    }))
    expect(analytics.reconciled).toHaveBeenCalledOnce()
  })

  it('records native-relative milestones for machine-readable startup traces', async () => {
    const startup = await import('./startupPerformance')

    startup.markStartupPhase('app_module_loaded')
    startup.markStartupPhase('vault_snapshot_received', 42)
    startup.markStartupPhase('app_interactive')
    await Promise.resolve()

    expect(invoke).toHaveBeenCalledWith('record_startup_milestone', {
      detail: null,
      name: 'app_module_loaded',
      rendererElapsedMs: expect.any(Number),
    })
    expect(invoke).toHaveBeenCalledWith('record_startup_milestone', {
      detail: 42,
      name: 'vault_snapshot_received',
      rendererElapsedMs: expect.any(Number),
    })
    expect(invoke).toHaveBeenCalledWith('record_startup_milestone', {
      detail: null,
      name: 'app_interactive',
      rendererElapsedMs: expect.any(Number),
    })
  })

  it('publishes browser-observable marks for the performance harness', async () => {
    const startup = await import('./startupPerformance')

    startup.markStartupPhase('app_interactive')
    startup.markStartupPhase('app_interactive')

    expect(performance.getEntriesByName('tolaria:app_interactive', 'mark')).toHaveLength(1)
  })

  it('releases deferred startup work when its prerequisite phase arrives', async () => {
    const startup = await import('./startupPerformance')
    const ready = startup.waitForStartupPhase('app_interactive')
    let released = false
    void ready.then(() => { released = true })

    await Promise.resolve()
    expect(released).toBe(false)

    startup.markStartupPhase('app_interactive')
    await ready
    expect(released).toBe(true)
  })
})
