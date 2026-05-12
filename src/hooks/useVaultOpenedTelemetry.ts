import { useEffect, useRef } from 'react'
import { trackEvent } from '../lib/telemetry'
import type { GitRepoState } from './useGitSetupState'

interface UseVaultOpenedTelemetryArgs {
  entryCount: number
  gitRepoState: GitRepoState
  resolvedPath: string
}

function shouldTrackVaultOpened(
  entryCount: number,
  gitRepoState: GitRepoState,
  resolvedPath: string,
  previousPath: string,
): boolean {
  const hasEntries = entryCount > 0
  const gitStateKnown = gitRepoState !== 'checking'
  const vaultChanged = resolvedPath !== previousPath

  return hasEntries && gitStateKnown && vaultChanged
}

export function useVaultOpenedTelemetry({
  entryCount,
  gitRepoState,
  resolvedPath,
}: UseVaultOpenedTelemetryArgs): void {
  const vaultOpenedRef = useRef('')

  useEffect(() => {
    if (!shouldTrackVaultOpened(entryCount, gitRepoState, resolvedPath, vaultOpenedRef.current)) return

    vaultOpenedRef.current = resolvedPath
    trackEvent('vault_opened', {
      has_git: gitRepoState === 'ready' ? 1 : 0,
      note_count: entryCount,
    })
  }, [entryCount, gitRepoState, resolvedPath])
}
