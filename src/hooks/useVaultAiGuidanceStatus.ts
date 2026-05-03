import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import {
  createCheckingVaultAiGuidanceStatus,
  normalizeVaultAiGuidanceStatus,
  type VaultAiGuidanceFileState,
  type VaultAiGuidanceStatus,
} from '../lib/vaultAiGuidance'

type RawVaultAiGuidanceStatus = Partial<{
  agents_state: VaultAiGuidanceFileState | null
  claude_state: VaultAiGuidanceFileState | null
  gemini_state: VaultAiGuidanceFileState | null
  can_restore: boolean | null
}>

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

export function useVaultAiGuidanceStatus(
  vaultPath: string | null | undefined,
  refreshKey = '',
): { status: VaultAiGuidanceStatus; refresh: () => Promise<VaultAiGuidanceStatus> } {
  const checkingStatus = useMemo(() => createCheckingVaultAiGuidanceStatus(), [])
  const [status, setStatus] = useState<VaultAiGuidanceStatus>(() => createCheckingVaultAiGuidanceStatus())

  const refresh = useCallback(async () => {
    if (!vaultPath) {
      return checkingStatus
    }

    try {
      const result = await tauriCall<RawVaultAiGuidanceStatus>('get_vault_ai_guidance_status', {
        vaultPath,
      })
      const normalized = normalizeVaultAiGuidanceStatus(result)
      setStatus(normalized)
      return normalized
    } catch {
      const checking = createCheckingVaultAiGuidanceStatus()
      setStatus(checking)
      return checking
    }
  }, [checkingStatus, vaultPath])

  useEffect(() => {
    let cancelled = false

    if (!vaultPath) return

    tauriCall<RawVaultAiGuidanceStatus>('get_vault_ai_guidance_status', { vaultPath })
      .then((result) => {
        if (!cancelled) {
          setStatus(normalizeVaultAiGuidanceStatus(result))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus(createCheckingVaultAiGuidanceStatus())
        }
      })

    return () => { cancelled = true }
  }, [vaultPath, refreshKey])

  return {
    status: vaultPath ? status : checkingStatus,
    refresh,
  }
}
