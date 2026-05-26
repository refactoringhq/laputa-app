import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
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
    expect(mermaidMock.render).toHaveBeenCalledWith(
      expect.stringMatching(/^tolaria-mermaid-/),
      'flowchart LR\nA --> B',
      expect.any(HTMLElement),
    )
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({
      htmlLabels: false,
      suppressErrorRendering: true,
      theme: 'default',
    }))
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

  it('keeps rendered SVG pointer events inside the Mermaid block', async () => {
    const onBlockPointer = vi.fn()
    render(
      <button type="button" onClick={onBlockPointer} onMouseDown={onBlockPointer}>
        <MermaidDiagram
          diagram={'flowchart LR\nA --> B'}
          source={'```mermaid\nflowchart LR\nA --> B\n```'}
        />
      </button>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram-viewport').querySelector('svg')).not.toBeNull()
    })

    const viewport = screen.getByTestId('mermaid-diagram-viewport')
    fireEvent.mouseDown(viewport)
    fireEvent.click(viewport)

    expect(onBlockPointer).not.toHaveBeenCalled()
  })

  it('tags Mermaid SVG style elements with the runtime CSP nonce', async () => {
    mermaidMock.render.mockResolvedValueOnce({
      svg: '<svg aria-label="Rendered Mermaid"><style>.node{fill:#000}</style><g><text>A to B</text></g></svg>',
    })

    render(
      <MermaidDiagram
        diagram={'flowchart LR\nA --> B'}
        source={'```mermaid\nflowchart LR\nA --> B\n```'}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram-viewport').querySelector('style')).not.toBeNull()
    })

    const style = screen.getByTestId('mermaid-diagram-viewport').querySelector('style')
    expect(style?.getAttribute('nonce')).toBe(RUNTIME_STYLE_NONCE)
  })

  it('keeps Mermaid foreignObject labels visible after sanitizing the SVG', async () => {
    mermaidMock.render.mockResolvedValueOnce({
      svg: [
        '<svg aria-label="Rendered Mermaid">',
        '<g class="node">',
        '<foreignObject width="200" height="40">',
        '<div xmlns="http://www.w3.org/1999/xhtml">',
        '<span class="nodeLabel" onclick="alert(1)">Employee<br>clocks in</span>',
        '</div>',
        '</foreignObject>',
        '</g>',
        '</svg>',
      ].join(''),
    })

    render(
      <MermaidDiagram
        diagram={'flowchart LR\nA(["Employee clocks in"]) --> B'}
        source={'```mermaid\nflowchart LR\nA(["Employee clocks in"]) --> B\n```'}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-diagram-viewport')).toHaveTextContent('Employeeclocks in')
    })
    expect(screen.getByText('Employeeclocks in')).not.toHaveAttribute('onclick')
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

  it('removes Mermaid error-rendering artifacts after a parse failure', async () => {
    let leakedId = ''
    mermaidMock.render.mockImplementationOnce(async (renderId: string, _diagram: string, container?: HTMLElement) => {
      leakedId = `d${renderId}`
      const leakedErrorSvgHost = document.createElement('div')
      leakedErrorSvgHost.id = leakedId
      leakedErrorSvgHost.textContent = 'Syntax error in text'
      const leakTarget = container ?? document.body
      leakTarget.appendChild(leakedErrorSvgHost)
      throw new Error('parse error')
    })

    render(
      <MermaidDiagram
        diagram={'flowchart TD\n## ABC'}
        source={'```mermaid\nflowchart TD\n## ABC\n```'}
      />,
    )

    expect(await screen.findByText('Mermaid diagram unavailable')).toBeInTheDocument()
    expect(document.getElementById(leakedId)).toBeNull()
  })
})
