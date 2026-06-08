import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExcalidrawFileEditor } from './ExcalidrawFileEditor'

vi.mock('./ExcalidrawCanvas', () => ({
  ExcalidrawCanvas: () => <div data-testid="excalidraw-canvas-mock" />,
}))

vi.mock('../utils/excalidrawTelemetry', () => ({
  trackExcalidrawOpened: vi.fn(),
}))

describe('ExcalidrawFileEditor', () => {
  it('renders the canvas for valid Excalidraw scene JSON', async () => {
    render(
      <ExcalidrawFileEditor
        path="diagram.excalidraw"
        content='{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}'
        onContentChange={vi.fn()}
        locale="en"
      />,
    )

    expect(await screen.findByTestId('excalidraw-canvas-mock')).toBeInTheDocument()
  })

  it('renders the canvas for an empty file (zero bytes)', async () => {
    render(
      <ExcalidrawFileEditor
        path="empty.excalidraw"
        content=""
        onContentChange={vi.fn()}
        locale="en"
      />,
    )

    expect(await screen.findByTestId('excalidraw-canvas-mock')).toBeInTheDocument()
  })

  it('shows the malformed-JSON fallback for unparseable content', () => {
    render(
      <ExcalidrawFileEditor
        path="bad.excalidraw"
        content='{not json'
        onContentChange={vi.fn()}
        locale="en"
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByTestId('excalidraw-file-editor-raw')).toHaveTextContent('{not json')
    expect(screen.queryByTestId('excalidraw-canvas-mock')).not.toBeInTheDocument()
  })

  it('shows the wrong-shape fallback for non-Excalidraw JSON', () => {
    render(
      <ExcalidrawFileEditor
        path="other.excalidraw"
        content='{"type":"figma","payload":1}'
        onContentChange={vi.fn()}
        locale="en"
      />,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByTestId('excalidraw-canvas-mock')).not.toBeInTheDocument()
  })
})
