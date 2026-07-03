import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
  it('starts empty slash-inserted blocks in source editing mode', async () => {
    renderHtmlBlock({ height: HTML_BLOCK_DEFAULT_HEIGHT, html: '' })

    const source = screen.getByLabelText('HTML source')
    expect(source).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(source))
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
