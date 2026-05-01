import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MermaidDiagram } from './MermaidDiagram'

const renderMock = vi.fn()
const initializeMock = vi.fn()

vi.mock('mermaid', () => ({
  default: {
    initialize: (...args: unknown[]) => initializeMock(...args),
    render: (...args: unknown[]) => renderMock(...args),
  },
}))

describe('MermaidDiagram', () => {
  beforeEach(() => {
    renderMock.mockReset()
    initializeMock.mockReset()
  })

  it('renders the SVG produced by mermaid.render', async () => {
    renderMock.mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"><g/></svg>' })
    render(<MermaidDiagram source="graph TD; A-->B" />)

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-svg')).toBeInTheDocument()
    })
    expect(initializeMock).toHaveBeenCalledWith(expect.objectContaining({ startOnLoad: false }))
    expect(renderMock).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), 'graph TD; A-->B')
  })

  it('marks container as busy while rendering and ready once done', async () => {
    let resolveRender: (value: { svg: string }) => void = () => {}
    renderMock.mockReturnValue(new Promise<{ svg: string }>((resolve) => { resolveRender = resolve }))

    render(<MermaidDiagram source="graph TD; A-->B" />)

    const container = screen.getByTestId('mermaid-diagram')
    expect(container.getAttribute('data-status')).toBe('idle')
    expect(container.getAttribute('aria-busy')).toBe('true')

    resolveRender({ svg: '<svg/>' })
    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram').getAttribute('data-status')).toBe('ready')
    })
  })

  it('shows an error state when mermaid.render rejects', async () => {
    renderMock.mockRejectedValue(new Error('Parse error on line 1'))
    render(<MermaidDiagram source="not valid" />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByText(/Failed to render Mermaid diagram/i)).toBeInTheDocument()
    expect(screen.getByText('Parse error on line 1')).toBeInTheDocument()
    expect(screen.getByText('not valid')).toBeInTheDocument()
  })

  it('re-renders when the source changes', async () => {
    renderMock.mockResolvedValue({ svg: '<svg/>' })
    const { rerender } = render(<MermaidDiagram source="graph TD; A-->B" />)

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1)
    })

    rerender(<MermaidDiagram source="graph LR; X-->Y" />)
    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(2)
    })
    expect(renderMock.mock.calls[1][1]).toBe('graph LR; X-->Y')
  })
})
