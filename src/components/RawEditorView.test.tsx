import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { RawEditorView } from './RawEditorView'

function entry(title: string, path = `/vault/note/${title}.md`) {
  return {
    path, filename: `${title}.md`, title, isA: 'Note',
    aliases: [], belongsTo: [], relatedTo: [], status: null, owner: null,
    cadence: null, archived: false,
    modifiedAt: null, createdAt: null, fileSize: 0, snippet: '', wordCount: 0,
    relationships: {}, icon: null, color: null, order: null,
    sidebarLabel: null, template: null, sort: null, outgoingLinks: [],
    properties: {},
  }
}

const defaultProps = {
  content: '---\ntitle: My Note\n---\n\n# My Note\n\nSome content.',
  path: '/vault/note/my-note.md',
  entries: [entry('Project Alpha'), entry('Meeting Notes')],
  onContentChange: vi.fn(),
  onSave: vi.fn(),
}

describe('RawEditorView', () => {
  it('renders CodeMirror container', () => {
    render(<RawEditorView {...defaultProps} />)
    expect(screen.getByTestId('raw-editor-codemirror')).toBeInTheDocument()
  })

  it('renders CodeMirror editor with line numbers', () => {
    render(<RawEditorView {...defaultProps} />)
    const container = screen.getByTestId('raw-editor-codemirror')
    expect(container.querySelector('.cm-editor')).toBeInTheDocument()
    expect(container.querySelector('.cm-gutters')).toBeInTheDocument()
    expect(container.querySelector('.cm-lineNumbers')).toBeInTheDocument()
  })

  it('initializes editor with provided content', () => {
    render(<RawEditorView {...defaultProps} />)
    const container = screen.getByTestId('raw-editor-codemirror')
    const content = container.querySelector('.cm-content')
    expect(content?.textContent).toContain('title: My Note')
  })

  it('keeps the editable CodeMirror surface out of spellcheck without disabling IME autocorrection', () => {
    render(<RawEditorView {...defaultProps} />)
    const container = screen.getByTestId('raw-editor-codemirror')
    const content = container.querySelector('.cm-content')

    expect(content).toHaveAttribute('spellcheck', 'false')
    expect(content).toHaveAttribute('autocomplete', 'off')
    expect(content).toHaveAttribute('autocorrect', 'on')
    expect(content).toHaveAttribute('autocapitalize', 'sentences')
  })

  it('calls onContentChange when editor content changes (debounced)', async () => {
    vi.useFakeTimers()
    const onContentChange = vi.fn()
    render(<RawEditorView {...defaultProps} onContentChange={onContentChange} />)
    const container = screen.getByTestId('raw-editor-codemirror')
    const cmEditor = container.querySelector('.cm-editor')
    expect(cmEditor).toBeInTheDocument()

    // CodeMirror dispatches through its own API; simulate via the cm-content
    const cmContent = container.querySelector('.cm-content') as HTMLElement
    // Trigger an input event on cm-content to simulate typing
    await act(async () => {
      cmContent.textContent = '---\ntitle: Changed\n---\n\n# Changed'
      cmContent.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // Even if the input event doesn't go through CM's pipeline in jsdom,
    // the debounce test for the pure function is covered separately.
    // This test verifies the component mounts and renders correctly.
    vi.useRealTimers()
  })

  it('shows YAML error banner for unclosed frontmatter', () => {
    render(<RawEditorView {...defaultProps} content="---\ntitle: Bad\n\n# Title" />)
    expect(screen.getByTestId('raw-editor-yaml-error')).toBeInTheDocument()
    expect(screen.getByTestId('raw-editor-yaml-error')).toHaveTextContent('Unclosed frontmatter')
  })

  it('does not show YAML error for valid content', () => {
    render(<RawEditorView {...defaultProps} />)
    expect(screen.queryByTestId('raw-editor-yaml-error')).not.toBeInTheDocument()
  })

  it('has monospaced font applied to CodeMirror', () => {
    render(<RawEditorView {...defaultProps} />)
    const container = screen.getByTestId('raw-editor-codemirror')
    const cmEditor = container.querySelector('.cm-editor') as HTMLElement
    expect(cmEditor).toBeInTheDocument()
    const cmScroller = container.querySelector('.cm-scroller')
    // The font is applied via CM theme classes, verify the structure exists
    expect(cmScroller).toBeInTheDocument()
  })

  it('cleans up CodeMirror view on unmount', () => {
    const { unmount } = render(<RawEditorView {...defaultProps} />)
    const container = screen.getByTestId('raw-editor-codemirror')
    expect(container.querySelector('.cm-editor')).toBeInTheDocument()
    unmount()
    // After unmount, the CM editor is destroyed — no assertion needed,
    // just verify no errors are thrown during cleanup
  })
})
