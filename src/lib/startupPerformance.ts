import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../mock-tauri'
import {
  trackStartupActiveVaultUsable,
  trackStartupBackgroundReconciled,
} from './productAnalytics'

export const STARTUP_TARGETS_MS = {
  activeVaultUsable: 800,
  reactShell: 300,
} as const
export const STARTUP_MARK_PREFIX = 'tolaria:'

type StartupSource = 'scan' | 'snapshot'
export type StartupPhase =
  | 'active_snapshot'
  | 'active_usable'
  | 'app_interactive'
  | 'app_module_loaded'
  | 'app_module_requested'
  | 'background_reconciled'
  | 'editor_committed'
  | 'editor_interactive'
  | 'editor_module_loaded'
  | 'editor_module_requested'
  | 'last_active_note_restore_started'
  | 'last_active_note_restored'
  | 'onboarding_ready'
  | 'react_shell'
  | 'renderer_module_loaded'
  | 'settings_loaded'
  | 'vault_load_started'
  | 'vault_registry_loaded'
  | 'vault_snapshot_received'

const frontendStartedAt = performance.now()
const phases = new Map<StartupPhase, number>()
const phaseWaiters = new Map<StartupPhase, Array<() => void>>()
let usableEventSent = false
let reconciliationEventSent = false

function elapsedSinceFrontendStart(): number {
  return Math.round(performance.now() - frontendStartedAt)
}

function recordNativeMilestone(
  name: StartupPhase,
  rendererElapsedMs: number,
  detail: number | null,
): void {
  if (!isTauri()) return
  void invoke('record_startup_milestone', { detail, name, rendererElapsedMs }).catch(() => {})
}

export function markStartupPhase(phase: StartupPhase, detail: number | null = null): number {
  const existing = phases.get(phase)
  if (existing !== undefined) return existing
  const elapsed = elapsedSinceFrontendStart()
  phases.set(phase, elapsed)
  performance.mark(`${STARTUP_MARK_PREFIX}${phase}`)
  const waiters = phaseWaiters.get(phase) ?? []
  phaseWaiters.delete(phase)
  for (const resolve of waiters) resolve()
  recordNativeMilestone(phase, elapsed, detail)
  return elapsed
}

export function waitForStartupPhase(phase: StartupPhase): Promise<void> {
  if (phases.has(phase)) return Promise.resolve()
  return new Promise((resolve) => {
    const waiters = phaseWaiters.get(phase) ?? []
    waiters.push(resolve)
    phaseWaiters.set(phase, waiters)
  })
}

async function nativeStartupElapsedMs(): Promise<number | null> {
  if (!isTauri()) return null
  try {
    return await invoke<number>('get_startup_elapsed_ms')
  } catch {
    return null
  }
}

export function recordActiveVaultSnapshot(entryCount: number): void {
  markStartupPhase('active_snapshot', entryCount)
  markStartupPhase('vault_snapshot_received', entryCount)
}

export function recordActiveVaultUsable(source: StartupSource, entryCount: number): void {
  const activeVaultUsableMs = markStartupPhase('active_usable')
  if (usableEventSent) return
  usableEventSent = true
  void nativeStartupElapsedMs().then((nativeElapsedMs) => {
    trackStartupActiveVaultUsable({
      activeVaultEntryCount: entryCount,
      activeVaultUsableMs,
      nativeElapsedMs,
      reactShellMs: phases.get('react_shell') ?? null,
      source,
      targetMs: STARTUP_TARGETS_MS.activeVaultUsable,
    })
  })
}

export function recordBackgroundReconciled(entryCount: number): void {
  const elapsedMs = markStartupPhase('background_reconciled')
  if (reconciliationEventSent) return
  reconciliationEventSent = true
  trackStartupBackgroundReconciled({ elapsedMs, entryCount })
}
