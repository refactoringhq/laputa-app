import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../hooks/appCommandDispatcher'
import { HTML_BLOCK_DEFAULT_HEIGHT, HTML_BLOCK_TYPE } from '../utils/htmlBlockMarkdown'
import { HtmlBlock, type HtmlBlockEditor, type HtmlBlockProps } from './HtmlBlock'

vi.mock('../utils/clipboardText', () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}))

function renderHtmlBlock(initialProps: HtmlBlockProps) {
  const liveBlock = {
    id: 'html-block',
    props: { ...initialProps },
    type: HTML_BLOCK_TYPE,
  }
  const editor: HtmlBlockEditor = {
    domElement: document.createElement('div'),
    focus: vi.fn(),
    getBlock: () => liveBlock,
    updateBlock: vi.fn((blockId, update) => {
      liveBlock.id = blockId
      liveBlock.props = { ...update.props }
      liveBlock.type = update.type
    }),
  }

  render(<HtmlBlock block={liveBlock} editor={editor} />)
  return { editor, liveBlock }
}

describe('HtmlBlock', () => {
  it('does not expose inline source editing for empty slash-inserted blocks', () => {
    renderHtmlBlock({ height: HTML_BLOCK_DEFAULT_HEIGHT, html: '' })

    expect(screen.queryByLabelText('HTML source')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit source' })).not.toBeInTheDocument()
  })

  it('renders sanitized HTML in an iframe without script or same-origin sandbox permissions', () => {
    renderHtmlBlock({
      height: HTML_BLOCK_DEFAULT_HEIGHT,
      html: '<script>window.parent.evil = true</script><button onclick="evil()">Click</button>',
    })

    const frame = screen.getByTitle('Sandboxed HTML block preview') as HTMLIFrameElement

    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.srcdoc).not.toContain('<script')
    expect(frame.srcdoc).not.toContain('onclick')
    expect(frame.srcdoc).toContain('<button>Click</button>')
  })

  it('exposes the preview container and controls with non-static roles', () => {
    renderHtmlBlock({
      height: HTML_BLOCK_DEFAULT_HEIGHT,
      html: '<p>Preview me</p>',
    })

    expect(screen.getByRole('region', { name: 'Sandboxed HTML block preview' })).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'HTML block actions' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit source' })).not.toBeInTheDocument()
  })

  it('routes blocked markup fixes to the raw editor instead of inline editing', () => {
    const commands: unknown[] = []
    const recordCommand = (event: Event) => {
      commands.push((event as CustomEvent<unknown>).detail)
    }
    window.addEventListener(APP_COMMAND_EVENT_NAME, recordCommand)

    try {
      renderHtmlBlock({
        height: HTML_BLOCK_DEFAULT_HEIGHT,
        html: '<script>blocked()</script>',
      })

      expect(screen.getByRole('alert')).toHaveTextContent('This HTML was blocked by the sandbox rules.')
      const rawEditorButtons = screen.getAllByRole('button', { name: 'Open raw editor' })
      fireEvent.click(rawEditorButtons.at(-1)!)

      expect(commands).toEqual([APP_COMMAND_IDS.editToggleRawEditor])
      expect(screen.queryByLabelText('HTML source')).not.toBeInTheDocument()
    } finally {
      window.removeEventListener(APP_COMMAND_EVENT_NAME, recordCommand)
    }
  })

  it('persists keyboard height changes through the editor block update path', () => {
    const { editor, liveBlock } = renderHtmlBlock({
      height: HTML_BLOCK_DEFAULT_HEIGHT,
      html: '<p>Resize me</p>',
    })

    fireEvent.keyDown(screen.getByRole('button', { name: 'Resize height' }), { key: 'ArrowDown' })

    expect(editor.updateBlock).toHaveBeenCalledWith('html-block', {
      props: { height: '344', html: '<p>Resize me</p>' },
      type: HTML_BLOCK_TYPE,
    })
    expect(liveBlock.props.height).toBe('344')
  })
})
