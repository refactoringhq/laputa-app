import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderMathToHtml } from '../utils/mathMarkdown'
import { SafeHtmlSpan } from './SafeMarkup'

describe('SafeHtmlSpan', () => {
  it('preserves KaTeX SVG radicals used by square root notation', async () => {
    const markup = renderMathToHtml({ latex: '\\sqrt{x}', displayMode: false })
    const { container } = render(<SafeHtmlSpan markup={markup} />)

    await waitFor(() => expect(container.querySelector('.katex svg path')).toBeInTheDocument())
    expect(container.querySelector('.katex svg')).toHaveAttribute('viewBox')
    expect(container.querySelector('.katex svg')).toHaveAttribute('preserveAspectRatio')
  })

  it('continues to remove script elements from sanitized markup', async () => {
    const { container } = render(<SafeHtmlSpan markup="<span>safe</span><script>alert('x')</script>" />)

    await waitFor(() => expect(container.querySelector('span')).toHaveTextContent('safe'))
    expect(container.querySelector('script')).not.toBeInTheDocument()
  })
})
