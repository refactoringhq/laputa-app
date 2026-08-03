import * as React from 'react'

import { isMac } from './platform'

let openSurfaceCount = 0
let lastReportedOpen = false

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
}

function reportOpenState(open: boolean): void {
  if (open === lastReportedOpen || !isMac() || !isTauriRuntime()) return
  lastReportedOpen = open
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('set_macos_dismissable_escape_surface_open', { open }))
    .catch(() => { /* A missing native command must not block surface dismissal. */ })
}

export function registerMacosDismissableEscapeSurface(): () => void {
  openSurfaceCount += 1
  reportOpenState(true)
  let registered = true

  return () => {
    if (!registered) return
    registered = false
    openSurfaceCount = Math.max(0, openSurfaceCount - 1)
    reportOpenState(openSurfaceCount > 0)
  }
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref) {
    ref.current = value
  }
}

export function useMacosDismissableEscapeSurfaceRef<T extends HTMLElement>(
  forwardedRef?: React.Ref<T>,
): React.RefCallback<T> {
  const unregisterRef = React.useRef<(() => void) | null>(null)

  const surfaceRef = React.useCallback((node: T | null) => {
    assignRef(forwardedRef, node)
    if (node && !unregisterRef.current) {
      unregisterRef.current = registerMacosDismissableEscapeSurface()
    } else if (!node && unregisterRef.current) {
      unregisterRef.current()
      unregisterRef.current = null
    }
  }, [forwardedRef])

  React.useEffect(() => () => {
    unregisterRef.current?.()
    unregisterRef.current = null
  }, [])

  return surfaceRef
}
