import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MathBlockEditor } from './editorSchema'
import { subscribeRichEditorExternalChange } from './editorExternalChangeEvents'

function renderMathBlockEditor(latex = '\\sqrt{x}') {
  const editor = {
    focus: vi.fn(),
    updateBlock: vi.fn(),
  }
  const block = {
    id: 'math-block',
    props: { latex },
  }

  render(<MathBlockEditor block={block} editor={editor} />)

  return { block, editor }
}

describe('MathBlockEditor', () => {
  it('renders display math without exposing Markdown delimiters as editor content', () => {
    renderMathBlockEditor()

    expect(document.querySelector('.math--block')).toHaveAttribute('data-latex', '\\sqrt{x}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('edits the math block latex prop instead of inserting Markdown source', () => {
    const { editor } = renderMathBlockEditor()
    const onExternalChange = vi.fn()
    const unsubscribe = subscribeRichEditorExternalChange(editor, onExternalChange)

    fireEvent.doubleClick(document.querySelector('.math--block')!)
    const source = screen.getByRole('textbox')
    fireEvent.change(source, { target: { value: '\\frac{1}{2}' } })
    fireEvent.blur(source)

    expect(editor.updateBlock).toHaveBeenCalledWith('math-block', {
      props: { latex: '\\frac{1}{2}' },
    })
    expect(editor.updateBlock).not.toHaveBeenCalledWith('math-block', {
      props: { latex: '$$\\frac{1}{2}$$' },
    })
    expect(onExternalChange).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('cancels math block editing without changing the block', () => {
    const { editor } = renderMathBlockEditor()

    fireEvent.doubleClick(document.querySelector('.math--block')!)
    const source = screen.getByRole('textbox')
    fireEvent.change(source, { target: { value: '\\frac{1}{2}' } })
    fireEvent.keyDown(source, { key: 'Escape' })
    fireEvent.blur(source)

    expect(editor.updateBlock).not.toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalled()
  })
})
