import type { VaultEntry } from '../types'

export interface ProbeTarget {
  entry: VaultEntry
  content: string
}

export interface ProcessMemoryEntry {
  pid: number
  parentPid: number
  rssBytes: number
  role: string
  command: string
}

export interface ProcessMemorySnapshot {
  currentPid: number
  totalRssBytes: number
  entries: ProcessMemoryEntry[]
}

export interface ProbeRunOptions {
  paths?: string[]
  limit?: number
  batchSize?: number
  settleMs?: number
}

export interface ProbeStep {
  mountedCount: number
  mountedPaths: string[]
  snapshot: ProcessMemorySnapshot | null
  deltaBytes: number | null
}

export interface ProbeTargetSummary {
  path: string
  fileSize: number
  contentBytes: number
  lineCount: number
}

export interface ProbeResult {
  targets: ProbeTargetSummary[]
  baseline: ProcessMemorySnapshot | null
  afterContentLoad: ProcessMemorySnapshot | null
  contentLoadDeltaBytes: number | null
  steps: ProbeStep[]
}

export interface ProbeWaiter {
  paths: Set<string>
  resolve: () => void
  timer: number
}

export interface EditorMemoryProbeApi {
  run: (options?: ProbeRunOptions) => Promise<ProbeResult>
  runAndCopy: (options?: ProbeRunOptions) => Promise<ProbeResult>
  clear: () => void
}
