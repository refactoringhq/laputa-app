import { useState, useEffect, useCallback } from 'react'
import { getAppStorageItem } from '../constants/appStorage'
import { getVaultConfig, updateVaultConfigField, subscribeVaultConfig } from '../utils/vaultConfigStore'

const MIN_ZOOM = 80
const MAX_ZOOM = 150
const STEP = 10
const DEFAULT_ZOOM = 100

/** Convert vault config zoom (0.8–1.5 fraction) to percentage (80–150). */
function configToPercent(zoom: number | null): number | null {
  if (zoom === null) return null
  const pct = Math.round(zoom * 100)
  return pct >= MIN_ZOOM && pct <= MAX_ZOOM ? pct : null
}

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

  // Re-sync when vault config becomes available
  useEffect(() => {
    return subscribeVaultConfig(() => {
      const pct = configToPercent(getVaultConfig().zoom)
      if (pct !== null) {
        setZoomLevel(pct)
        applyZoomToDocument(pct)
      }
    })
  }, [])

  const zoomIn = useCallback(() => {
    setZoomLevel(prev => {
      const next = Math.min(MAX_ZOOM, prev + STEP)
      applyZoomToDocument(next)
      persistZoom(next)
      return next
    })
  }, [])

  const zoomOut = useCallback(() => {
    setZoomLevel(prev => {
      const next = Math.max(MIN_ZOOM, prev - STEP)
      applyZoomToDocument(next)
      persistZoom(next)
      return next
    })
  }, [])

  const zoomReset = useCallback(() => {
    setZoomLevel(DEFAULT_ZOOM)
    applyZoomToDocument(DEFAULT_ZOOM)
    persistZoom(DEFAULT_ZOOM)
  }, [])

  return { zoomLevel, zoomIn, zoomOut, zoomReset }
}
