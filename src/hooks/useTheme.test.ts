import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useEditorTheme } from './useTheme'

describe('useEditorTheme', () => {
  it('keeps inline code on the muted editor surface without exporting code block overrides', () => {
    const { result } = renderHook(() => useEditorTheme())

    expect(result.current.cssVars['--inline-styles-code-background-color']).toBe(
      'var(--bg-hover-subtle)'
    )
    expect(result.current.cssVars['--code-blocks-background-color']).toBeUndefined()
  })

  it('keeps h4 visually between body text and h3 while remaining bold', () => {
    const { result } = renderHook(() => useEditorTheme())

    const bodySize = Number.parseFloat(result.current.cssVars['--editor-font-size'])
    const h3Size = Number.parseFloat(result.current.cssVars['--headings-h3-font-size'])
    const h4Size = Number.parseFloat(result.current.cssVars['--headings-h4-font-size'])

    expect(h4Size).toBeGreaterThan(bodySize)
    expect(h4Size).toBeLessThan(h3Size)
    expect(result.current.cssVars['--headings-h4-font-weight']).toBe('600')
  })

  it('exports the default editor max width', () => {
    const { result } = renderHook(() => useEditorTheme())

    expect(result.current.cssVars['--editor-max-width']).toBe('820px')
  })
})
