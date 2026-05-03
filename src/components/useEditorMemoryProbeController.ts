import { useCallback, useRef, useState } from 'react'
import type { VaultEntry } from '../types'
import type {
  ProbeResult,
  ProbeRunOptions,
  ProbeStep,
  ProbeTarget,
  ProbeWaiter,
} from './editorMemoryProbeTypes'
import {
  copyProbeResult,
  DEFAULT_PROBE_BATCH_SIZE,
  DEFAULT_PROBE_SETTLE_MS,
  loadProbeTarget,
  memoryDelta,
  readMemorySnapshot,
  resolveMountCounts,
  selectProbeEntries,
  settleAfterMount,
  summarizeTarget,
  PROBE_READY_TIMEOUT_MS,
} from './editorMemoryProbeRuntime'

function createProbeStep(
  mountedTargets: ProbeTarget[],
  snapshot: Awaited<ReturnType<typeof readMemorySnapshot>>,
  baseline: Awaited<ReturnType<typeof readMemorySnapshot>>,
): ProbeStep {
  return {
    mountedCount: mountedTargets.length,
    mountedPaths: mountedTargets.map(target => target.entry.path),
    snapshot,
    deltaBytes: memoryDelta(snapshot, baseline),
  }
}

function useProbeReadiness() {
  const readyPathsRef = useRef(new Set<string>())
  const waiterRef = useRef<ProbeWaiter | null>(null)

  const resolveWaiterIfReady = useCallback(() => {
    const waiter = waiterRef.current
    if (!waiter) return
    for (const path of waiter.paths) {
      if (!readyPathsRef.current.has(path)) return
    }

    window.clearTimeout(waiter.timer)
    waiterRef.current = null
    waiter.resolve()
  }, [])

  const handleReady = useCallback((path: string) => {
    readyPathsRef.current.add(path)
    resolveWaiterIfReady()
  }, [resolveWaiterIfReady])

  const waitForReadyPaths = useCallback((paths: string[]) => {
    return new Promise<void>((resolve) => {
      const unresolvedPaths = paths.filter(path => !readyPathsRef.current.has(path))
      if (unresolvedPaths.length === 0) {
        resolve()
        return
      }

      const timer = window.setTimeout(() => {
        waiterRef.current = null
        console.warn('[memory-probe] Timed out waiting for hidden editors:', unresolvedPaths)
        resolve()
      }, PROBE_READY_TIMEOUT_MS)
      waiterRef.current = { paths: new Set(paths), resolve, timer }
    })
  }, [])

  const clearReadiness = useCallback(() => {
    if (waiterRef.current) {
      window.clearTimeout(waiterRef.current.timer)
      waiterRef.current = null
    }
    readyPathsRef.current.clear()
  }, [])

  return { clearReadiness, handleReady, waitForReadyPaths }
}

export function useEditorMemoryProbeController(entries: VaultEntry[]) {
  const [targets, setTargets] = useState<ProbeTarget[]>([])
  const { clearReadiness, handleReady, waitForReadyPaths } = useProbeReadiness()

  const clear = useCallback(() => {
    clearReadiness()
    setTargets([])
  }, [clearReadiness])

  const run = useCallback(async (options: ProbeRunOptions = {}): Promise<ProbeResult> => {
    clear()
    await settleAfterMount(options.settleMs ?? DEFAULT_PROBE_SETTLE_MS)
    const baseline = await readMemorySnapshot()
    const selectedEntries = selectProbeEntries(entries, options)
    const loadedTargets = await Promise.all(selectedEntries.map(loadProbeTarget))
    const afterContentLoad = await readMemorySnapshot()
    const batchSize = Math.max(1, options.batchSize ?? DEFAULT_PROBE_BATCH_SIZE)
    const settleMs = options.settleMs ?? DEFAULT_PROBE_SETTLE_MS
    const steps: ProbeStep[] = []

    for (const count of resolveMountCounts(loadedTargets.length, batchSize)) {
      const mountedTargets = loadedTargets.slice(0, count)
      setTargets(mountedTargets)
      await waitForReadyPaths(mountedTargets.map(target => target.entry.path))
      await settleAfterMount(settleMs)
      steps.push(createProbeStep(mountedTargets, await readMemorySnapshot(), baseline))
    }

    return {
      targets: loadedTargets.map(summarizeTarget),
      baseline,
      afterContentLoad,
      contentLoadDeltaBytes: memoryDelta(afterContentLoad, baseline),
      steps,
    }
  }, [clear, entries, waitForReadyPaths])

  const runAndCopy = useCallback(async (options: ProbeRunOptions = {}) => {
    const result = await run(options)
    await copyProbeResult(result)
    console.info('[memory-probe] Result copied to clipboard', result)
    return result
  }, [run])

  return { clear, handleReady, run, runAndCopy, targets }
}
