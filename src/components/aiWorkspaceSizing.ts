import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export type AiWorkspaceMode = 'docked' | 'side' | 'window'

export interface AiWorkspaceSizing {
  onSidebarResize: (delta: number) => void
  onWorkspaceResize: (deltaWidth: number, deltaHeight: number) => void
  sidebarWidth: number
  workspaceSize: { height: number; width: number }
}

const DEFAULT_DOCKED_WORKSPACE_SIZE = { height: 540, width: 560 }
const MIN_DOCKED_WORKSPACE_SIZE = { height: 360, width: 460 }
const DEFAULT_SIDE_WORKSPACE_WIDTH = 320
const MIN_SIDE_WORKSPACE_WIDTH = 320
const SIDE_WORKSPACE_WIDTH_STORAGE_KEY = 'tolaria:ai-workspace-side-width'
const DEFAULT_SIDEBAR_WIDTH = 168
const MIN_SIDEBAR_WIDTH = 132
const MAX_SIDEBAR_WIDTH = 240

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function maxDockedWorkspaceSize(): { height: number; width: number } {
  if (typeof window === 'undefined') return { height: 680, width: 880 }

  return {
    height: Math.max(MIN_DOCKED_WORKSPACE_SIZE.height, window.innerHeight - 88),
    width: Math.max(MIN_DOCKED_WORKSPACE_SIZE.width, window.innerWidth - 32),
  }
}

function readStoredSideWorkspaceWidth(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_SIDE_WORKSPACE_WIDTH

  try {
    const parsed = Number(localStorage.getItem(SIDE_WORKSPACE_WIDTH_STORAGE_KEY))
    if (!Number.isFinite(parsed)) return DEFAULT_SIDE_WORKSPACE_WIDTH
    return clampNumber(parsed, MIN_SIDE_WORKSPACE_WIDTH, maxDockedWorkspaceSize().width)
  } catch {
    return DEFAULT_SIDE_WORKSPACE_WIDTH
  }
}

function writeStoredSideWorkspaceWidth(width: number): void {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(SIDE_WORKSPACE_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Ignore unavailable or restricted localStorage implementations.
  }
}

export function workspaceClassName(mode: AiWorkspaceMode, expanded = false): string {
  if (mode === 'side') {
    return cn(
      'z-20 flex h-full min-h-0 overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground',
      expanded ? 'absolute inset-0 border-l-0' : 'relative shrink-0',
    )
  }

  if (mode === 'window') {
    return 'flex h-full w-full overflow-hidden bg-background text-foreground'
  }

  return 'fixed right-4 bottom-[30px] z-40 flex overflow-hidden rounded-lg border border-border bg-background text-foreground'
}

export function workspaceStyle(
  mode: AiWorkspaceMode,
  size: AiWorkspaceSizing['workspaceSize'],
  expanded = false,
): CSSProperties | undefined {
  if (mode === 'window') return undefined
  if (mode === 'side') {
    if (expanded) return undefined
    return {
      minWidth: MIN_SIDE_WORKSPACE_WIDTH,
      width: size.width,
    }
  }

  return {
    height: size.height,
    maxHeight: 'calc(100vh - 62px)',
    maxWidth: 'calc(100vw - 32px)',
    minHeight: MIN_DOCKED_WORKSPACE_SIZE.height,
    minWidth: MIN_DOCKED_WORKSPACE_SIZE.width,
    width: size.width,
  }
}

export function useAiWorkspaceSizing(mode: AiWorkspaceMode): AiWorkspaceSizing {
  const [workspaceSize, setWorkspaceSize] = useState(() => (
    mode === 'side'
      ? { height: DEFAULT_DOCKED_WORKSPACE_SIZE.height, width: readStoredSideWorkspaceWidth() }
      : DEFAULT_DOCKED_WORKSPACE_SIZE
  ))
  const workspaceSizeRef = useRef(workspaceSize)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)

  const onWorkspaceResize = useCallback((deltaWidth: number, deltaHeight: number) => {
    if (mode === 'window') return
    const current = workspaceSizeRef.current
    const max = maxDockedWorkspaceSize()
    const minWidth = mode === 'side' ? MIN_SIDE_WORKSPACE_WIDTH : MIN_DOCKED_WORKSPACE_SIZE.width
    const next = {
      height: clampNumber(current.height + deltaHeight, MIN_DOCKED_WORKSPACE_SIZE.height, max.height),
      width: clampNumber(current.width + deltaWidth, minWidth, max.width),
    }
    workspaceSizeRef.current = next
    if (mode === 'side') writeStoredSideWorkspaceWidth(next.width)
    setWorkspaceSize(next)
  }, [mode])
  const onSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((current) => clampNumber(current + delta, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH))
  }, [])

  useEffect(() => {
    workspaceSizeRef.current = workspaceSize
  }, [workspaceSize])

  useEffect(() => {
    if (mode === 'side') writeStoredSideWorkspaceWidth(workspaceSize.width)
  }, [mode, workspaceSize.width])

  return { onSidebarResize, onWorkspaceResize, sidebarWidth, workspaceSize }
}
