import { describe, it, expect, vi, afterEach } from 'vitest'
import { getDocumentZoom, adjustCoordsForZoom } from './zoomCursorFix'

function mockComputedZoom(value: string) {
  const real = window.getComputedStyle.bind(window)
  return vi.spyOn(window, 'getComputedStyle').mockImplementation((elt, pseudo) => {
    const style = real(elt, pseudo)
    if (elt === document.documentElement) {
      return new Proxy(style, {
        get(target, prop) {
          if (prop === 'zoom') return value
          const val = Reflect.get(target, prop)
          return typeof val === 'function' ? val.bind(target) : val
        },
      })
    }
    return style
  })
}

describe('getDocumentZoom', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 1 when no zoom is set', () => {
    expect(getDocumentZoom()).toBe(1)
  })

  it('returns the zoom factor when computed style reports a decimal', () => {
    const spy = mockComputedZoom('1.5')
    expect(getDocumentZoom()).toBe(1.5)
    spy.mockRestore()
  })

  it('normalizes a computed percentage zoom value', () => {
    const spy = mockComputedZoom('125%')
    expect(getDocumentZoom()).toBe(1.25)
    spy.mockRestore()
  })

  it('returns the zoom factor for sub-100% zoom', () => {
    const spy = mockComputedZoom('0.8')
    expect(getDocumentZoom()).toBe(0.8)
    spy.mockRestore()
  })

  it('returns 1 for zoom: normal', () => {
    const spy = mockComputedZoom('normal')
    expect(getDocumentZoom()).toBe(1)
    spy.mockRestore()
  })

  it('returns 1 for empty/missing zoom value', () => {
    const spy = mockComputedZoom('')
    expect(getDocumentZoom()).toBe(1)
    spy.mockRestore()
  })
})

describe('adjustCoordsForZoom', () => {
  it('returns coords unchanged when zoom is 1', () => {
    expect(adjustCoordsForZoom({ x: 200, y: 100 }, 1)).toEqual({ x: 200, y: 100 })
  })

  it('divides coords by zoom factor for zoom > 1', () => {
    const result = adjustCoordsForZoom({ x: 300, y: 150 }, 1.5)
    expect(result.x).toBe(200)
    expect(result.y).toBe(100)
  })

  it('divides coords by zoom factor for zoom < 1', () => {
    const result = adjustCoordsForZoom({ x: 160, y: 80 }, 0.8)
    expect(result.x).toBe(200)
    expect(result.y).toBe(100)
  })

  it('handles common zoom levels correctly', () => {
    // 90% zoom
    const at90 = adjustCoordsForZoom({ x: 90, y: 90 }, 0.9)
    expect(at90.x).toBeCloseTo(100, 10)
    expect(at90.y).toBeCloseTo(100, 10)

    // 110% zoom
    const at110 = adjustCoordsForZoom({ x: 110, y: 110 }, 1.1)
    expect(at110.x).toBeCloseTo(100, 10)
    expect(at110.y).toBeCloseTo(100, 10)

    // 125% zoom
    const at125 = adjustCoordsForZoom({ x: 125, y: 125 }, 1.25)
    expect(at125.x).toBeCloseTo(100, 10)
    expect(at125.y).toBeCloseTo(100, 10)
  })
})
