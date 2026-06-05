import { useEffect, useState } from 'react'
import type { GitCommit } from '../types'

const GIT_HISTORY_LOAD_DELAY_MS = 200

export function useGitHistory(
  activeTabPath: string | null,
  loadGitHistory: (path: string) => Promise<GitCommit[]>,
  enabled = true,
  refreshKey = 0,
) {
  const [loadedHistory, setLoadedHistory] = useState<{
    path: string | null
    commits: GitCommit[]
    refreshKey: number
  }>({
    path: null,
    commits: [],
    refreshKey: -1,
  })

  useEffect(() => {
    if (!enabled || !activeTabPath) return

    let cancelled = false

    const timeoutId = window.setTimeout(() => {
      void loadGitHistory(activeTabPath).then((history) => {
        if (cancelled) return
        setLoadedHistory({
          path: activeTabPath,
          commits: history,
          refreshKey,
        })
      })
    }, GIT_HISTORY_LOAD_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [activeTabPath, enabled, loadGitHistory, refreshKey])

  return enabled && activeTabPath && loadedHistory.path === activeTabPath && loadedHistory.refreshKey === refreshKey
    ? loadedHistory.commits
    : []
}
