import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from 'react'

export interface CommitDiffRequest {
  requestId: number
  path: string
  commitHash?: string | null
}

interface UseDiffModeParams {
  activeTabPath: string | null
  onLoadDiff?: (path: string) => Promise<string>
  onLoadDiffAtCommit?: (path: string, commitHash: string) => Promise<string>
  pendingCommitDiffRequest?: CommitDiffRequest | null
  onPendingCommitDiffHandled?: (requestId: number) => void
}

interface DiffStateSetters {
  setDiffMode: Dispatch<SetStateAction<boolean>>
  setDiffContent: Dispatch<SetStateAction<string | null>>
  setDiffLoading: Dispatch<SetStateAction<boolean>>
  setDiffPath: Dispatch<SetStateAction<string | null>>
}

type DiffLoadCancellation = { current: boolean }

function useDiffLoadCancellation() {
  const activeDiffLoadRef = useRef<DiffLoadCancellation | null>(null)

  const cancelActiveDiffLoad = useCallback(() => {
    if (!activeDiffLoadRef.current) return
    activeDiffLoadRef.current.current = true
    activeDiffLoadRef.current = null
  }, [])

  const createDiffLoadCancellation = useCallback(() => {
    cancelActiveDiffLoad()
    const cancellation = { current: false }
    activeDiffLoadRef.current = cancellation
    return cancellation
  }, [cancelActiveDiffLoad])

  const clearDiffLoadCancellation = useCallback((cancellation: DiffLoadCancellation) => {
    if (activeDiffLoadRef.current === cancellation) {
      activeDiffLoadRef.current = null
    }
  }, [])

  return {
    cancelActiveDiffLoad,
    createDiffLoadCancellation,
    clearDiffLoadCancellation,
  }
}

async function loadDiffForPath(
  path: string,
  onLoadDiff: ((path: string) => Promise<string>) | undefined,
  { setDiffMode, setDiffContent, setDiffLoading, setDiffPath }: DiffStateSetters,
) {
  if (!onLoadDiff) return
  setDiffLoading(true)
  try {
    const diff = await onLoadDiff(path)
    setDiffContent(diff)
    setDiffPath(path)
    setDiffMode(true)
  } catch (err) {
    console.warn('Failed to load diff:', err)
  } finally {
    setDiffLoading(false)
  }
}

async function loadCommitDiffForPath(
  path: string,
  commitHash: string,
  onLoadDiffAtCommit: ((path: string, commitHash: string) => Promise<string>) | undefined,
  { setDiffMode, setDiffContent, setDiffLoading, setDiffPath }: DiffStateSetters,
) {
  if (!onLoadDiffAtCommit) return
  setDiffLoading(true)
  try {
    const diff = await onLoadDiffAtCommit(path, commitHash)
    setDiffContent(diff)
    setDiffPath(path)
    setDiffMode(true)
  } catch (err) {
    console.warn('Failed to load commit diff:', err)
  } finally {
    setDiffLoading(false)
  }
}

function shouldHandlePendingCommitDiffRequest(
  activeTabPath: string | null,
  pendingCommitDiffRequest: CommitDiffRequest | null | undefined,
): pendingCommitDiffRequest is CommitDiffRequest {
  return !!pendingCommitDiffRequest && pendingCommitDiffRequest.path === activeTabPath
}

function hasCommitHash(pendingCommitDiffRequest: CommitDiffRequest): pendingCommitDiffRequest is CommitDiffRequest & { commitHash: string } {
  return typeof pendingCommitDiffRequest.commitHash === 'string' && pendingCommitDiffRequest.commitHash.length > 0
}

function buildGuardedDiffStateSetters(
  cancelledRef: DiffLoadCancellation,
  { setDiffMode, setDiffContent, setDiffLoading, setDiffPath }: DiffStateSetters,
): DiffStateSetters {
  return {
    setDiffMode: (value) => { if (!cancelledRef.current) setDiffMode(value) },
    setDiffContent: (value) => { if (!cancelledRef.current) setDiffContent(value) },
    setDiffLoading: (value) => { if (!cancelledRef.current) setDiffLoading(value) },
    setDiffPath: (value) => { if (!cancelledRef.current) setDiffPath(value) },
  }
}

function closeDiffMode(activeTabPath: string | null, {
  setDiffMode,
  setDiffContent,
  setDiffLoading,
  setDiffPath,
}: DiffStateSetters) {
  setDiffPath(activeTabPath)
  setDiffMode(false)
  setDiffContent(null)
  setDiffLoading(false)
}

function runPendingCommitDiffRequest(
  pendingCommitDiffRequest: CommitDiffRequest,
  onLoadDiff: ((path: string) => Promise<string>) | undefined,
  onLoadDiffAtCommit: ((path: string, commitHash: string) => Promise<string>) | undefined,
  onPendingCommitDiffHandled: ((requestId: number) => void) | undefined,
  diffState: DiffStateSetters,
) {
  const cancelledRef = { current: false }

  const loadDiffPromise = hasCommitHash(pendingCommitDiffRequest)
    ? loadCommitDiffForPath(
      pendingCommitDiffRequest.path,
      pendingCommitDiffRequest.commitHash,
      onLoadDiffAtCommit,
      buildGuardedDiffStateSetters(cancelledRef, diffState),
    )
    : loadDiffForPath(
      pendingCommitDiffRequest.path,
      onLoadDiff,
      buildGuardedDiffStateSetters(cancelledRef, diffState),
    )

  void loadDiffPromise.finally(() => {
    if (cancelledRef.current) return
    onPendingCommitDiffHandled?.(pendingCommitDiffRequest.requestId)
  })

  return () => {
    cancelledRef.current = true
  }
}

function usePendingCommitDiffRequest({
  activeTabPath,
  onLoadDiff,
  onLoadDiffAtCommit,
  pendingCommitDiffRequest,
  onPendingCommitDiffHandled,
  setDiffMode,
  setDiffContent,
  setDiffLoading,
  setDiffPath,
}: UseDiffModeParams & DiffStateSetters) {
  useEffect(() => {
    if (!shouldHandlePendingCommitDiffRequest(activeTabPath, pendingCommitDiffRequest)) return
    if (hasCommitHash(pendingCommitDiffRequest) && !onLoadDiffAtCommit) {
      onPendingCommitDiffHandled?.(pendingCommitDiffRequest.requestId)
      return
    }
    if (!hasCommitHash(pendingCommitDiffRequest) && !onLoadDiff) {
      onPendingCommitDiffHandled?.(pendingCommitDiffRequest.requestId)
      return
    }

    return runPendingCommitDiffRequest(
      pendingCommitDiffRequest,
      onLoadDiff,
      onLoadDiffAtCommit,
      onPendingCommitDiffHandled,
      { setDiffMode, setDiffContent, setDiffLoading, setDiffPath },
    )
  }, [activeTabPath, onLoadDiff, onLoadDiffAtCommit, onPendingCommitDiffHandled, pendingCommitDiffRequest, setDiffContent, setDiffLoading, setDiffMode, setDiffPath])
}

function useDiffPathReset(
  activeTabPath: string | null,
  cancelActiveDiffLoad: () => void,
  diffState: DiffStateSetters,
) {
  useEffect(() => {
    cancelActiveDiffLoad()
    closeDiffMode(activeTabPath, diffState)
  }, [activeTabPath, cancelActiveDiffLoad, diffState])
}

function useCancelDiffLoadOnUnmount(cancelActiveDiffLoad: () => void) {
  useEffect(() => () => cancelActiveDiffLoad(), [cancelActiveDiffLoad])
}

export function useDiffMode({
  activeTabPath,
  onLoadDiff,
  onLoadDiffAtCommit,
  pendingCommitDiffRequest,
  onPendingCommitDiffHandled,
}: UseDiffModeParams) {
  const [diffMode, setDiffMode] = useState(false)
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffPath, setDiffPath] = useState<string | null>(activeTabPath)
  const diffState = useMemo(() => ({
    setDiffMode,
    setDiffContent,
    setDiffLoading,
    setDiffPath,
  }), [setDiffMode, setDiffContent, setDiffLoading, setDiffPath])
  const {
    cancelActiveDiffLoad,
    createDiffLoadCancellation,
    clearDiffLoadCancellation,
  } = useDiffLoadCancellation()

  useDiffPathReset(activeTabPath, cancelActiveDiffLoad, diffState)
  useCancelDiffLoadOnUnmount(cancelActiveDiffLoad)

  usePendingCommitDiffRequest({
    activeTabPath,
    onLoadDiff,
    onLoadDiffAtCommit,
    pendingCommitDiffRequest,
    onPendingCommitDiffHandled,
    setDiffMode,
    setDiffContent,
    setDiffLoading,
    setDiffPath,
  })

  const isDiffVisible = diffMode && diffPath === activeTabPath

  const handleToggleDiff = useCallback(async () => {
    if (isDiffVisible) {
      cancelActiveDiffLoad()
      closeDiffMode(activeTabPath, diffState)
      return
    }
    if (!activeTabPath || !onLoadDiff) return
    const cancellation = createDiffLoadCancellation()
    try {
      await loadDiffForPath(activeTabPath, onLoadDiff, buildGuardedDiffStateSetters(cancellation, diffState))
    } finally {
      clearDiffLoadCancellation(cancellation)
    }
  }, [activeTabPath, cancelActiveDiffLoad, clearDiffLoadCancellation, createDiffLoadCancellation, diffState, isDiffVisible, onLoadDiff])

  const handleViewCommitDiff = useCallback(async (commitHash: string) => {
    if (!activeTabPath) return
    const cancellation = createDiffLoadCancellation()
    try {
      await loadCommitDiffForPath(activeTabPath, commitHash, onLoadDiffAtCommit, buildGuardedDiffStateSetters(cancellation, diffState))
    } finally {
      clearDiffLoadCancellation(cancellation)
    }
  }, [activeTabPath, clearDiffLoadCancellation, createDiffLoadCancellation, diffState, onLoadDiffAtCommit])

  return {
    diffMode: isDiffVisible,
    diffContent: isDiffVisible ? diffContent : null,
    diffLoading,
    handleToggleDiff,
    handleViewCommitDiff,
  }
}
