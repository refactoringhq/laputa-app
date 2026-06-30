import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDocumentThemeMode } from './useDocumentThemeMode'

describe('useDocumentThemeMode', () => {
  beforeEach(() => {
    globalThis.document.documentElement.removeAttribute('data-theme')
    globalThis.document.documentElement.classList.remove('dark')
  })

  it('defaults to light when no document theme is applied', () => {
    const { result } = renderHook(() => useDocumentThemeMode())

    expect(result.current).toBe('light')
  })

  it('updates when the document theme changes', async () => {
    const { result } = renderHook(() => useDocumentThemeMode())

    await act(async () => {
      globalThis.document.documentElement.setAttribute('data-theme', 'dark')
      globalThis.document.documentElement.classList.add('dark')
      await Promise.resolve()
    })

    expect(result.current).toBe('dark')
  })
})
