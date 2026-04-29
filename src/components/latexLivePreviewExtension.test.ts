import { describe, expect, it } from 'vitest'
import { readActiveMathSource } from './latexLivePreviewExtension'

describe('readActiveMathSource', () => {
  it('reads inline math while the user is typing before the closing delimiter', () => {
    expect(readActiveMathSource('Energy $E=mc^2', 14)).toEqual({
      displayMode: false,
      latex: 'E=mc^2',
    })
  })

  it('reads inline math while the cursor is inside completed delimiters', () => {
    expect(readActiveMathSource('Energy $E=mc^2$ today', 13)).toEqual({
      displayMode: false,
      latex: 'E=mc^2',
    })
  })

  it('does not preview inline math after the cursor leaves the closing delimiter', () => {
    expect(readActiveMathSource('Energy $E=mc^2$ today', 16)).toBeNull()
  })

  it('reads display math from double-dollar delimiters', () => {
    expect(readActiveMathSource('$$\\int_0^1 x\\,dx', 17)).toEqual({
      displayMode: true,
      latex: '\\int_0^1 x\\,dx',
    })
  })

  it('prefers display math over inline parsing for double-dollar input', () => {
    expect(readActiveMathSource('$$x^2$$', 4)).toEqual({
      displayMode: true,
      latex: 'x^2',
    })
  })

  it('ignores escaped dollar signs', () => {
    expect(readActiveMathSource('Price \\$5 and text', 9)).toBeNull()
  })

  it('keeps previewing when escaped dollars appear inside math source', () => {
    expect(readActiveMathSource('Cost $x + \\$5', 13)).toEqual({
      displayMode: false,
      latex: 'x + \\$5',
    })
  })
})
