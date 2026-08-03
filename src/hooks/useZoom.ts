import { useState, useEffect, useCallback, useRef } from 'react'
import { getAppStorageItem } from '../constants/appStorage'
import { getVaultConfig, updateVaultConfigField, subscribeVaultConfig } from '../utils/vaultConfigStore'

const MIN_ZOOM = 80
const MAX_ZOOM = 150
const STEP = 10
const DEFAULT_ZOOM = 100

function loadPersistedZoom(): number {
  const fromConfig = configToPercent(getVaultConfig().zoom)
  if (fromConfig !== null) return fromConfig
  // Fallback to localStorage during initial load
  const stored = getAppStorageItem('zoom')
  if (stored !== null) {
    const val = Number(stored)
    if (val >= MIN_ZOOM && val <= MAX_ZOOM && val % STEP === 0) return val
  }
  return DEFAULT_ZOOM
}

function isSupportedZoomPercent(value: number): boolean {
  return value >= MIN_ZOOM && value <= MAX_ZOOM
}

/** Convert vault config zoom (0.8–1.5 fraction) to percentage (80–150). */
function configToPercent(zoom: number | null): number | null {
  if (zoom === null) return null
  const percent = Math.round(zoom * 100)
  return isSupportedZoomPercent(percent) ? percent : null
}

function applyZoomToDocument(level: number): void {
  document.documentElement.style.setProperty('zoom', `${level}%`)
  document.documentElement.style.setProperty('--tolaria-overlay-zoom-factor', String(level / DEFAULT_ZOOM))
  document.documentElement.style.setProperty('--tolaria-overlay-zoom-inverse', String(DEFAULT_ZOOM / level))
  window.dispatchEvent(new Event('laputa-zoom-change'))
}

function persistZoom(level: number): void {
  updateVaultConfigField('zoom', level / 100)
}

export function useZoom() {
  const [zoomLevel, setZoomLevel] = useState(() => {
    const level = loadPersistedZoom()
    // Apply zoom synchronously during init so child components (e.g. CodeMirror)
    // measure the correct scale factor in their own effects.
    applyZoomToDocument(level)
    return level
  })
  const zoomLevelRef = useRef(zoomLevel)

  const syncZoomLevel = useCallback((level: number) => {
    zoomLevelRef.current = level
    setZoomLevel(level)
    applyZoomToDocument(level)
  }, [])

  const commitZoomLevel = useCallback((level: number, forcePersist = false) => {
    const unchanged = level === zoomLevelRef.current
    if (!unchanged) {
      syncZoomLevel(level)
    }
    if (!unchanged || forcePersist) {
      persistZoom(level)
    }
  }, [syncZoomLevel])

  // Re-sync when vault config becomes available
  useEffect(() => {
    return subscribeVaultConfig(() => {
      const pct = configToPercent(getVaultConfig().zoom)
      if (pct !== null && pct !== zoomLevelRef.current) {
        syncZoomLevel(pct)
      }
    })
  }, [syncZoomLevel])

  const zoomIn = useCallback(() => {
    commitZoomLevel(Math.min(MAX_ZOOM, zoomLevelRef.current + STEP))
  }, [commitZoomLevel])

  const zoomOut = useCallback(() => {
    commitZoomLevel(Math.max(MIN_ZOOM, zoomLevelRef.current - STEP))
  }, [commitZoomLevel])

  const zoomReset = useCallback(() => {
    commitZoomLevel(DEFAULT_ZOOM, true)
  }, [commitZoomLevel])

  return { zoomLevel, zoomIn, zoomOut, zoomReset }
}
