import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidDiagram } from './MermaidDiagram'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}))

vi.mock('mermaid', () => ({
  default: mermaidMock,
}))

describe('MermaidDiagram', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mermaidMock.render.mockResolvedValue({
      svg: '<svg aria-label="Rendered Mermaid"><g><text>A to B</text></g></svg>',
    })
  })

  it('renders Mermaid SVG for valid source', async () => {
    render(
      <MermaidDiagram
        diagram={'flowchart LR\nA --> B'}
        source={'```mermaid\nflowchart LR\nA --> B\n```'}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram-viewport').querySelector('svg')).not.toBeNull()
    })
    expect(mermaidMock.render).toHaveBeenCalledWith(expect.stringMatching(/^tolaria-mermaid-/), 'flowchart LR\nA --> B')
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: 'default' }))
  })

  it('opens the rendered SVG in a lightbox', async () => {
    render(
      <MermaidDiagram
        diagram={'flowchart LR\nA --> B'}
        source={'```mermaid\nflowchart LR\nA --> B\n```'}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram-viewport').querySelector('svg')).not.toBeNull()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open Mermaid diagram' }))
    expect(screen.getByTestId('mermaid-diagram-dialog-viewport').querySelector('svg')).not.toBeNull()
  })

  it('falls back to the original source when Mermaid cannot render', async () => {
    mermaidMock.render.mockRejectedValueOnce(new Error('parse error'))

    render(
      <MermaidDiagram
        diagram={'flowchart LR\nA --'}
        source={'```mermaid\nflowchart LR\nA --\n```'}
      />,
    )

    expect(await screen.findByText('Mermaid diagram unavailable')).toBeInTheDocument()
    expect(screen.getByLabelText('Mermaid source')).toHaveTextContent('flowchart LR')
  })
})
