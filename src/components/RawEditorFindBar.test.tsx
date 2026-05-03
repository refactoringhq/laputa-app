import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EditorView } from '@codemirror/view'
import { RawEditorFindBar } from './RawEditorFindBar'

function renderFindBar(overrides: Partial<React.ComponentProps<typeof RawEditorFindBar>> = {}) {
  const view = {
    dispatch: vi.fn(),
    focus: vi.fn(),
  } as unknown as EditorView
  const props = {
    doc: 'Alpha beta Alpha',
    locale: 'en' as const,
    onClose: vi.fn(),
    onReplaceOpenChange: vi.fn(),
    open: true,
    path: '/vault/a.md',
    replaceOpen: false,
    request: { id: 1, path: '/vault/a.md', replace: false },
    viewRef: { current: view },
    ...overrides,
  }

  render(<RawEditorFindBar {...props} />)
  return { props, view }
}

describe('RawEditorFindBar', () => {
  it('finds matches and moves the CodeMirror selection', async () => {
    const { view } = renderFindBar()

    const input = screen.getByTestId('raw-editor-find-input')
    input.focus()

    fireEvent.change(input, {
      target: { value: 'Alpha' },
    })

    await waitFor(() => {
      expect(screen.getByTestId('raw-editor-find-count')).toHaveTextContent('1 / 2')
      expect(view.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
        selection: { anchor: 0, head: 5 },
      }))
    })
    expect(input).toHaveFocus()
    expect(view.focus).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Next match' }))

    await waitFor(() => {
      expect(screen.getByTestId('raw-editor-find-count')).toHaveTextContent('2 / 2')
      expect(view.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
        selection: { anchor: 11, head: 16 },
      }))
    })
  })

  it('opens replace mode and dispatches regex replacement changes', async () => {
    const onReplaceOpenChange = vi.fn()
    const { view } = renderFindBar({
      doc: 'foo-123 foo-456',
      onReplaceOpenChange,
      replaceOpen: true,
      request: { id: 2, path: '/vault/a.md', replace: true },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Use regular expression' }))
    fireEvent.change(screen.getByTestId('raw-editor-find-input'), {
      target: { value: 'foo-(\\d+)' },
    })
    fireEvent.change(screen.getByTestId('raw-editor-replace-input'), {
      target: { value: 'bar-$1' },
    })

    await waitFor(() => {
      expect(screen.getByTestId('raw-editor-find-count')).toHaveTextContent('1 / 2')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Replace' }))

    expect(view.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      changes: { from: 0, insert: 'bar-123', to: 7 },
      selection: { anchor: 0, head: 7 },
    }))
    expect(view.focus).toHaveBeenCalled()
    expect(onReplaceOpenChange).toHaveBeenCalledWith(true)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderFindBar({ onClose })

    fireEvent.keyDown(screen.getByTestId('raw-editor-find-bar'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })
})
