import type { VaultEntry } from '../types'

export type VaultAiGuidanceFileState = 'checking' | 'managed' | 'missing' | 'broken' | 'custom'

export interface VaultAiGuidanceStatus {
  agentsState: VaultAiGuidanceFileState
  claudeState: VaultAiGuidanceFileState
  geminiState: VaultAiGuidanceFileState
  canRestore: boolean
}

type RawVaultAiGuidanceStatus = Partial<{
  agents_state: VaultAiGuidanceFileState | null
  claude_state: VaultAiGuidanceFileState | null
  gemini_state: VaultAiGuidanceFileState | null
  can_restore: boolean | null
}>

const GUIDANCE_FILENAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'])

export function createCheckingVaultAiGuidanceStatus(): VaultAiGuidanceStatus {
  return {
    agentsState: 'checking',
    claudeState: 'checking',
    geminiState: 'checking',
    canRestore: false,
  }
}

function normalizeFileState(value: string | null | undefined): VaultAiGuidanceFileState {
  switch (value) {
    case 'managed':
    case 'missing':
    case 'broken':
    case 'custom':
      return value
    default:
      return 'checking'
  }
}

export function normalizeVaultAiGuidanceStatus(
  payload: RawVaultAiGuidanceStatus | null | undefined,
): VaultAiGuidanceStatus {
  return {
    agentsState: normalizeFileState(payload?.agents_state),
    claudeState: normalizeFileState(payload?.claude_state),
    geminiState: normalizeFileState(payload?.gemini_state),
    canRestore: payload?.can_restore === true,
  }
}

export function isVaultAiGuidanceStatusChecking(status: VaultAiGuidanceStatus): boolean {
  return status.agentsState === 'checking'
    || status.claudeState === 'checking'
    || status.geminiState === 'checking'
}

export function vaultAiGuidanceNeedsRestore(status: VaultAiGuidanceStatus): boolean {
  if (!status.canRestore || isVaultAiGuidanceStatusChecking(status)) return false
  return status.agentsState === 'missing'
    || status.agentsState === 'broken'
    || status.claudeState === 'missing'
    || status.claudeState === 'broken'
    || status.geminiState === 'missing'
    || status.geminiState === 'broken'
}

export function vaultAiGuidanceUsesCustomFiles(status: VaultAiGuidanceStatus): boolean {
  return status.agentsState === 'custom'
    || status.claudeState === 'custom'
    || status.geminiState === 'custom'
}

function isMissingOrBroken(state: VaultAiGuidanceFileState): boolean {
  return state === 'missing' || state === 'broken'
}

function formatGuidanceFileList(names: string[]): string {
  if (names.length < 2) return names.join('')
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function getBrokenGuidanceSummary(status: VaultAiGuidanceStatus): string | null {
  if (isMissingOrBroken(status.agentsState)) {
    return 'Tolaria guidance missing or broken'
  }
  if (isMissingOrBroken(status.claudeState)) {
    return 'Claude compatibility shim missing or broken'
  }
  if (status.geminiState === 'missing') {
    return 'Gemini guidance can be created'
  }
  if (status.geminiState === 'broken') {
    return 'Gemini guidance missing or broken'
  }
  return null
}

function getCustomGuidanceSummary(status: VaultAiGuidanceStatus): string | null {
  const customNames = [
    status.agentsState === 'custom' ? 'AGENTS.md' : null,
    status.claudeState === 'custom' ? 'CLAUDE.md' : null,
    status.geminiState === 'custom' ? 'GEMINI.md' : null,
  ].filter((name): name is string => name !== null)
  if (customNames.length > 1) {
    return `Custom ${formatGuidanceFileList(customNames)} active`
  }
  if (status.agentsState === 'custom') return 'Using custom AGENTS.md'
  if (status.claudeState === 'custom') return 'Using custom CLAUDE.md'
  if (status.geminiState === 'custom') return 'Using custom GEMINI.md'
  return null
}

export function getVaultAiGuidanceSummary(status: VaultAiGuidanceStatus): string {
  if (isVaultAiGuidanceStatusChecking(status)) return 'Checking vault guidance…'
  const brokenSummary = getBrokenGuidanceSummary(status)
  if (brokenSummary) return brokenSummary
  const customSummary = getCustomGuidanceSummary(status)
  if (customSummary) return customSummary
  return 'Tolaria guidance ready'
}

export function buildVaultAiGuidanceRefreshKey(entries: VaultEntry[]): string {
  return entries
    .filter((entry) => GUIDANCE_FILENAMES.has(entry.filename))
    .map((entry) => `${entry.path}:${entry.modifiedAt ?? 0}:${entry.fileSize}`)
    .sort()
    .join('|')
}
