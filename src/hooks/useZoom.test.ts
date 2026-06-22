import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useZoom } from './useZoom'
import { bindVaultConfigStore, getVaultConfig, resetVaultConfigStore } from '../utils/vaultConfigStore'

const DEFAULT_VC = { zoom: null, view_mode: null, editor_mode: null, tag_colors: null, status_colors: null, property_display_modes: null }
const ZOOM_CHANGE_CASES = [
  ['zoomIn', (zoom) => zoom.zoomIn(), undefined],
  ['zoomOut', (zoom) => zoom.zoomOut(), undefined],
  ['zoomReset', (zoom) => zoom.zoomReset(), 1.2],
]

function expectZoomChangeEvent(runZoom, initialZoom) {
  if (initialZoom !== undefined) {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC, zoom: initialZoom }, vi.fn())
  }
  const handler = vi.fn()
  globalThis.addEventListener('laputa-zoom-change', handler)
  try {
    const { result } = renderHook(() => useZoom())
    handler.mockClear()
    act(() => runZoom(result.current))
    expect(handler).toHaveBeenCalled()
  } finally {
    globalThis.removeEventListener('laputa-zoom-change', handler)
  }
}

describe('useZoom', () => {
  beforeEach(() => {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC }, vi.fn())
    globalThis.document.documentElement.style.removeProperty('zoom')
  })

  it('initializes at 100% by default', () => {
    const { result } = renderHook(() => useZoom())
    expect(result.current.zoomLevel).toBe(100)
  })

  it('restores persisted zoom level from vault config', () => {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC, zoom: 1.2 }, vi.fn())
    const { result } = renderHook(() => useZoom())
    expect(result.current.zoomLevel).toBe(120)
  })

  it('defaults to 100 when vault config zoom is null', () => {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC, zoom: null }, vi.fn())
    const { result } = renderHook(() => useZoom())
    expect(result.current.zoomLevel).toBe(100)
  })

  it('ignores out-of-range persisted values', () => {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC, zoom: 2.0 }, vi.fn())
    const { result } = renderHook(() => useZoom())
    expect(result.current.zoomLevel).toBe(100)
  })

  it('zoomIn increases level by 10', () => {
    const { result } = renderHook(() => useZoom())
    act(() => result.current.zoomIn())
    expect(result.current.zoomLevel).toBe(110)
    expect(getVaultConfig().zoom).toBe(1.1)
  })

  it('zoomOut decreases level by 10', () => {
    const { result } = renderHook(() => useZoom())
    act(() => result.current.zoomOut())
    expect(result.current.zoomLevel).toBe(90)
    expect(getVaultConfig().zoom).toBe(0.9)
  })

  it('zoomIn clamps at 150', () => {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC, zoom: 1.5 }, vi.fn())
    const { result } = renderHook(() => useZoom())
    act(() => result.current.zoomIn())
    expect(result.current.zoomLevel).toBe(150)
  })

  it('zoomOut clamps at 80', () => {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC, zoom: 0.8 }, vi.fn())
    const { result } = renderHook(() => useZoom())
    act(() => result.current.zoomOut())
    expect(result.current.zoomLevel).toBe(80)
  })

  it('zoomReset returns to 100', () => {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC, zoom: 1.3 }, vi.fn())
    const { result } = renderHook(() => useZoom())
    act(() => result.current.zoomReset())
    expect(result.current.zoomLevel).toBe(100)
    expect(getVaultConfig().zoom).toBe(1.0)
  })

  it('applies CSS zoom property to document element', () => {
    const spy = vi.spyOn(globalThis.document.documentElement.style, 'setProperty')
    const { result } = renderHook(() => useZoom())
    spy.mockClear() // clear the mount call
    act(() => result.current.zoomIn())
    expect(spy).toHaveBeenCalledWith('zoom', '110%')
    spy.mockRestore()
  })

  it('zoomIn and zoomOut are stable callbacks', () => {
    const { result, rerender } = renderHook(() => useZoom())
    const { zoomIn: a, zoomOut: b, zoomReset: c } = result.current
    rerender()
    expect(result.current.zoomIn).toBe(a)
    expect(result.current.zoomOut).toBe(b)
    expect(result.current.zoomReset).toBe(c)
  })

  it('successive zoomIn calls accumulate', () => {
    const { result } = renderHook(() => useZoom())
    act(() => result.current.zoomIn())
    act(() => result.current.zoomIn())
    act(() => result.current.zoomIn())
    expect(result.current.zoomLevel).toBe(130)
  })

  it('defaults to 100 when vault config store is empty', () => {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC }, vi.fn())
    const { result } = renderHook(() => useZoom())
    expect(result.current.zoomLevel).toBe(100)
  })

  it.each(ZOOM_CHANGE_CASES)('dispatches laputa-zoom-change event on %s', (_name, runZoom, initialZoom) => {
    expectZoomChangeEvent(runZoom, initialZoom)
  })

  it('applies CSS zoom synchronously during initialization', () => {
    resetVaultConfigStore()
    bindVaultConfigStore({ ...DEFAULT_VC, zoom: 1.2 }, vi.fn())
    const spy = vi.spyOn(globalThis.document.documentElement.style, 'setProperty')
    renderHook(() => useZoom())
    // Zoom should be applied during state init (setProperty called with zoom value)
    expect(spy).toHaveBeenCalledWith('zoom', '120%')
    spy.mockRestore()
  })
})
