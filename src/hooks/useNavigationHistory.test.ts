import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNavigationHistory } from './useNavigationHistory'

function renderNavigationHistory(paths = []) {
  const hook = renderHook(() => useNavigationHistory())
  if (paths.length > 0) {
    act(() => {
      paths.forEach((path) => hook.result.current.push(path))
    })
  }
  return hook
}

function navigate(result, direction, isValidPath) {
  let target = null
  act(() => { target = result.current[direction](isValidPath) })
  return target
}

describe('useNavigationHistory', () => {
  it('starts with empty state', () => {
    const { result } = renderHook(() => useNavigationHistory())
    expect(result.current.canGoBack).toBe(false)
    expect(result.current.canGoForward).toBe(false)
  })

  it('push adds path to history', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => result.current.push('/a'))
    expect(result.current.canGoBack).toBe(false)
    expect(result.current.canGoForward).toBe(false)
  })

  it('back returns previous path after two pushes', () => {
    const { result } = renderNavigationHistory(['/a', '/b'])
    expect(result.current.canGoBack).toBe(true)

    expect(navigate(result, 'goBack')).toBe('/a')
    expect(result.current.canGoBack).toBe(false)
    expect(result.current.canGoForward).toBe(true)
  })

  it('forward returns next path after going back', () => {
    const { result } = renderNavigationHistory(['/a', '/b'])
    navigate(result, 'goBack')

    expect(navigate(result, 'goForward')).toBe('/b')
    expect(result.current.canGoForward).toBe(false)
  })

  it('push after back clears forward stack', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => { result.current.push('/a'); result.current.push('/b'); result.current.push('/c') })
    act(() => { result.current.goBack() })
    expect(result.current.canGoForward).toBe(true)

    act(() => { result.current.push('/d') })
    expect(result.current.canGoForward).toBe(false)

    expect(navigate(result, 'goBack')).toBe('/b')
  })

  it('duplicate push is a no-op', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => { result.current.push('/a'); result.current.push('/a') })
    expect(result.current.canGoBack).toBe(false)
  })

  it('goBack skips invalid paths', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => { result.current.push('/a'); result.current.push('/b'); result.current.push('/c') })

    expect(navigate(result, 'goBack', (p) => p !== '/b')).toBe('/a')
  })

  it('goForward skips invalid paths', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => { result.current.push('/a'); result.current.push('/b'); result.current.push('/c') })
    act(() => { result.current.goBack(); result.current.goBack() })

    expect(navigate(result, 'goForward', (p) => p !== '/b')).toBe('/c')
  })

  it('goBack returns null when nothing valid remains', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => { result.current.push('/a') })

    expect(navigate(result, 'goBack')).toBeNull()
  })

  it('goForward returns null at end of history', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => { result.current.push('/a') })

    expect(navigate(result, 'goForward')).toBeNull()
  })

  it('removePath adjusts cursor correctly', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => { result.current.push('/a'); result.current.push('/b'); result.current.push('/c') })
    act(() => { result.current.removePath('/b') })

    expect(navigate(result, 'goBack')).toBe('/a')
  })

  it('removePath when current note is removed', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => { result.current.push('/a'); result.current.push('/b') })
    act(() => { result.current.removePath('/b') })
    // After removing /b (cursor was at index 1), cursor should adjust
    expect(result.current.canGoBack).toBe(false)
    expect(result.current.canGoForward).toBe(false)
  })

  it('goBack without predicate returns closed-tab paths (replace scenario)', () => {
    const { result } = renderHook(() => useNavigationHistory())
    // Simulate: open A, then B replaces A, then C replaces B
    act(() => { result.current.push('/a'); result.current.push('/b'); result.current.push('/c') })

    // Without a predicate, goBack returns /b even though its tab was replaced
    let target = navigate(result, 'goBack')
    expect(target).toBe('/b')

    target = navigate(result, 'goBack')
    expect(target).toBe('/a')
  })

  it('goBack with entry-exists predicate skips deleted notes but returns replaced tabs', () => {
    const { result } = renderNavigationHistory(['/a', '/deleted', '/c'])

    // Simulate: /deleted was removed from vault, but /a still exists
    const vaultPaths = new Set(['/a', '/c'])
    const isEntryExists = (p) => vaultPaths.has(p)

    // Should skip /deleted and return /a
    expect(navigate(result, 'goBack', isEntryExists)).toBe('/a')
  })

  it('goForward with entry-exists predicate skips deleted notes', () => {
    const { result } = renderNavigationHistory(['/a', '/deleted', '/c'])
    navigate(result, 'goBack')
    navigate(result, 'goBack')

    const vaultPaths = new Set(['/a', '/c'])
    const isEntryExists = (p) => vaultPaths.has(p)

    // Should skip /deleted and return /c
    expect(navigate(result, 'goForward', isEntryExists)).toBe('/c')
  })

  it('handles long navigation chain', () => {
    const { result } = renderHook(() => useNavigationHistory())
    act(() => {
      for (let i = 0; i < 10; i++) result.current.push(`/${i}`)
    })
    expect(result.current.canGoBack).toBe(true)

    // Go all the way back
    for (let i = 8; i >= 0; i--) {
      expect(navigate(result, 'goBack')).toBe(`/${i}`)
    }
    expect(result.current.canGoBack).toBe(false)

    // Go all the way forward
    for (let i = 1; i <= 9; i++) {
      expect(navigate(result, 'goForward')).toBe(`/${i}`)
    }
    expect(result.current.canGoForward).toBe(false)
  })
})
