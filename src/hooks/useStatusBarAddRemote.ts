import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { GitRemoteStatus } from '../types'
import { REQUEST_ADD_REMOTE_EVENT } from '../utils/addRemoteEvents'

function tauriCall<T>(command: string, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

async function readRemoteStatus(vaultPath: string): Promise<GitRemoteStatus | null> {
  try {
    return await tauriCall<GitRemoteStatus>('git_remote_status', { vaultPath })
  } catch (error) {
    void error
    return null
  }
}

interface UseStatusBarAddRemoteOptions {
  vaultPath: string
  isGitVault: boolean
  remoteStatus?: GitRemoteStatus | null
  onAddRemote?: () => void
}

interface StatusBarAddRemoteState {
  openAddRemote: () => Promise<void>
  closeAddRemote: () => void
  showAddRemote: boolean
  visibleRemoteStatus: GitRemoteStatus | null
  handleRemoteConnected: (message: string) => Promise<void>
}

interface RemoteStatusOverride {
  vaultPath: string
  status: GitRemoteStatus | null
}

export function useStatusBarAddRemote({
  vaultPath,
  isGitVault,
  remoteStatus,
  onAddRemote,
}: UseStatusBarAddRemoteOptions): StatusBarAddRemoteState {
  const [showAddRemote, setShowAddRemote] = useState(false)
  const [remoteStatusOverride, setRemoteStatusOverride] = useState<RemoteStatusOverride | null>(null)

  const refreshRemoteStatus = useCallback(async () => {
    const latestStatus = await readRemoteStatus(vaultPath)
    if (latestStatus) {
      setRemoteStatusOverride({ vaultPath, status: latestStatus })
    }
    return latestStatus
  }, [vaultPath])

  const openAddRemote = useCallback(async () => {
    if (onAddRemote) {
      onAddRemote()
      return
    }

    if (!isGitVault) return

    const latestStatus = await refreshRemoteStatus()
    if (latestStatus?.hasRemote) {
      setShowAddRemote(false)
      return
    }

    setShowAddRemote(true)
  }, [isGitVault, onAddRemote, refreshRemoteStatus])

  const closeAddRemote = useCallback(() => {
    setShowAddRemote(false)
  }, [])

  const handleRemoteConnected = useCallback(async (message: string) => {
    void message
    await refreshRemoteStatus()
  }, [refreshRemoteStatus])

  useEffect(() => {
    const handleRequest = () => {
      void openAddRemote()
    }

    window.addEventListener(REQUEST_ADD_REMOTE_EVENT, handleRequest)
    return () => { window.removeEventListener(REQUEST_ADD_REMOTE_EVENT, handleRequest); }
  }, [openAddRemote])

  const visibleRemoteStatus = useMemo(
    () => (
      remoteStatusOverride?.vaultPath === vaultPath
        ? remoteStatusOverride.status
        : remoteStatus ?? null
    ),
    [remoteStatus, remoteStatusOverride, vaultPath],
  )

  return {
    openAddRemote,
    closeAddRemote,
    showAddRemote,
    visibleRemoteStatus,
    handleRemoteConnected,
  }
}
