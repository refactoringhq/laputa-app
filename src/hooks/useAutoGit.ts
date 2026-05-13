import { useCallback, useEffect, useEffectEvent, useRef } from 'react'

export type AutoGitTrigger = 'idle' | 'inactive'

interface UseAutoGitOptions {
  enabled: boolean
  idleThresholdSeconds: number
  inactiveThresholdSeconds: number
  isGitVault: boolean
  hasPendingChanges: boolean
  hasUnsavedChanges: boolean
  onCheckpoint: (trigger: AutoGitTrigger) => Promise<boolean>
}

interface TriggerState {
  idle: number | null
  inactive: number | null
}

interface AutoGitState {
  recordActivity: () => void
}

interface CheckpointEligibility {
  enabled: boolean
  isGitVault: boolean
  hasPendingChanges: boolean
  hasUnsavedChanges: boolean
}

function isDocumentActive(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

function resetTriggerState(target: TriggerState): void {
  target.idle = null
  target.inactive = null
}

function thresholdMsForTrigger(
  trigger: AutoGitTrigger,
  idleThresholdSeconds: number,
  inactiveThresholdSeconds: number,
): number {
  return (trigger === 'idle' ? idleThresholdSeconds : inactiveThresholdSeconds) * 1000
}

function isCheckpointEligible({
  enabled,
  isGitVault,
  hasPendingChanges,
  hasUnsavedChanges,
}: CheckpointEligibility): boolean {
  return enabled && isGitVault && hasPendingChanges && !hasUnsavedChanges
}

function markTriggerAsHandled(
  target: TriggerState,
  trigger: AutoGitTrigger,
  activityAt: number,
): void {
  Reflect.set(target, trigger, activityAt)
}

function shouldTriggerCheckpoint({
  eligibility,
  trigger,
  lastTriggeredAt,
  lastActivityAt,
  idleThresholdSeconds,
  inactiveThresholdSeconds,
}: {
  eligibility: CheckpointEligibility
  trigger: AutoGitTrigger
  lastTriggeredAt: number | null
  lastActivityAt: number
  idleThresholdSeconds: number
  inactiveThresholdSeconds: number
}): boolean {
  if (!isCheckpointEligible(eligibility)) return false
  if (lastTriggeredAt === lastActivityAt) return false

  const thresholdMs = thresholdMsForTrigger(
    trigger,
    idleThresholdSeconds,
    inactiveThresholdSeconds,
  )
  return Date.now() - lastActivityAt >= thresholdMs
}

export function useAutoGit({
  enabled,
  idleThresholdSeconds,
  inactiveThresholdSeconds,
  isGitVault,
  hasPendingChanges,
  hasUnsavedChanges,
  onCheckpoint,
}: UseAutoGitOptions): AutoGitState {
  const lastActivityAtRef = useRef(0)
  const lastTriggeredRef = useRef<TriggerState>({ idle: null, inactive: null })
  const appActiveRef = useRef(true)

  const recordActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now()
    resetTriggerState(lastTriggeredRef.current)
  }, [])

  const maybeTriggerCheckpoint = useEffectEvent((trigger: AutoGitTrigger) => {
    const lastActivityAt = lastActivityAtRef.current
    const eligibility = {
      enabled,
      isGitVault,
      hasPendingChanges,
      hasUnsavedChanges,
    }
    if (!shouldTriggerCheckpoint({
      eligibility,
      trigger,
      lastTriggeredAt: Reflect.get(lastTriggeredRef.current, trigger) as number | null,
      lastActivityAt,
      idleThresholdSeconds,
      inactiveThresholdSeconds,
    })) return

    void onCheckpoint(trigger).then((didRun) => {
      if (didRun) markTriggerAsHandled(lastTriggeredRef.current, trigger, lastActivityAt)
    }).catch((err) => {
      markTriggerAsHandled(lastTriggeredRef.current, trigger, lastActivityAt)
      console.warn('[git] Auto-commit failed:', err)
    })
  })

  const updateAppActivity = useEffectEvent((active: boolean) => {
    if (appActiveRef.current === active) return
    appActiveRef.current = active

    if (active) {
      lastTriggeredRef.current.inactive = null
    } else {
      lastTriggeredRef.current.idle = null
    }

    maybeTriggerCheckpoint(active ? 'idle' : 'inactive')
  })

  useEffect(() => {
    lastActivityAtRef.current = Date.now()
    appActiveRef.current = isDocumentActive()

    const handleFocus = () => { updateAppActivity(true) }
    const handleBlur = () => { updateAppActivity(false) }
    const handleVisibilityChange = () => { updateAppActivity(isDocumentActive()) }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const id = window.setInterval(() => {
      maybeTriggerCheckpoint(appActiveRef.current ? 'idle' : 'inactive')
    }, 1000)

    return () => window.clearInterval(id)
  }, [enabled])

  return { recordActivity }
}
