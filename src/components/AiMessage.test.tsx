import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AiMessage } from './AiMessage'

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-testid="markdown-content">{content}</div>,
}))

const writeClipboardText = vi.fn()

vi.mock('../utils/clipboardText', () => ({
  writeClipboardText: (text: string) => writeClipboardText(text),
}))

describe('AiMessage', () => {
  beforeEach(() => {
    writeClipboardText.mockReset()
    writeClipboardText.mockResolvedValue(undefined)
  })

  it('renders user message', () => {
    const { container } = render(<AiMessage userMessage="Hello AI" actions={[]} />)
    expect(screen.getByText('Hello AI')).toBeTruthy()
    expect(container.querySelector('[style*="background: var(--state-hover)"]')).toBeTruthy()
  })

  it('renders response as markdown', () => {
    render(<AiMessage userMessage="Ask" actions={[]} response="Here is the **answer**" />)
    expect(screen.getByTestId('markdown-content')).toBeTruthy()
    expect(screen.getByText('Here is the **answer**')).toBeTruthy()
  })

  it('shows assistant message actions with response', () => {
    render(<AiMessage userMessage="Ask" actions={[]} response="Done" />)
    expect(screen.getByTestId('ai-message-actions')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Regenerate response' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy response' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fork chat from here' })).toBeTruthy()
  })

  it('localizes reasoning and tool use chrome', () => {
    render(
      <AiMessage
        userMessage="Fai qualcosa"
        locale="it-IT"
        reasoning="Sto pensando..."
        reasoningDone
        actions={[{ tool: 'search_notes', toolId: 't1', label: 'Cercato', status: 'done' }]}
      />,
    )

    expect(screen.getByRole('button', { name: /ragionamento/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /uso degli strumenti/i })).toBeTruthy()
  })

  it('shows reasoning expanded while streaming (reasoningDone=false)', () => {
    render(<AiMessage userMessage="Ask" reasoning="Thinking about it..." reasoningDone={false} actions={[]} />)
    expect(screen.getByTestId('reasoning-toggle')).toBeTruthy()
    expect(screen.getByTestId('reasoning-content')).toBeTruthy()
    expect(screen.getByText('Thinking about it...')).toBeTruthy()
  })

  it('auto-collapses reasoning when reasoningDone=true', () => {
    render(<AiMessage userMessage="Ask" reasoning="Thinking..." reasoningDone actions={[]} />)
    expect(screen.getByTestId('reasoning-toggle')).toBeTruthy()
    expect(screen.queryByTestId('reasoning-content')).toBeNull()
  })

  it('expands collapsed reasoning on toggle click', () => {
    render(<AiMessage userMessage="Ask" reasoning="Thinking..." reasoningDone actions={[]} />)
    // Starts collapsed (reasoningDone=true)
    expect(screen.queryByTestId('reasoning-content')).toBeNull()
    fireEvent.click(screen.getByTestId('reasoning-toggle'))
    expect(screen.getByTestId('reasoning-content')).toBeTruthy()
  })

  it('collapses expanded reasoning on toggle click', () => {
    render(<AiMessage userMessage="Ask" reasoning="Thinking..." reasoningDone={false} actions={[]} />)
    // Starts expanded (reasoningDone=false)
    expect(screen.getByTestId('reasoning-content')).toBeTruthy()
    fireEvent.click(screen.getByTestId('reasoning-toggle'))
    expect(screen.queryByTestId('reasoning-content')).toBeNull()
  })

  it('collapses tool use by default and shows the live call count', () => {
    render(
      <AiMessage
        userMessage="Do something"
        actions={[
          { tool: 'create_note', toolId: 't1', label: 'Created test.md', status: 'done' },
          { tool: 'search_notes', toolId: 't2', label: 'Searched', status: 'pending' },
        ]}
      />,
    )
    expect(screen.getByTestId('tool-use-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('tool-use-count').textContent).toBe('2')
    expect(screen.getByTestId('tool-use-count')).toHaveAttribute('data-pending', 'true')
    expect(screen.queryByTestId('ai-action-card')).toBeNull()

    fireEvent.click(screen.getByTestId('tool-use-toggle'))

    expect(screen.getByTestId('tool-use-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId('ai-action-card')).toHaveLength(2)
  })

  it('passes onOpenNote to action cards', () => {
    const onOpenNote = vi.fn()
    render(
      <AiMessage
        userMessage="Do"
        actions={[{ tool: 'create_note', toolId: 't1', label: 'Open', path: '/vault/note.md', status: 'done' }]}
        onOpenNote={onOpenNote}
      />,
    )
    fireEvent.click(screen.getByTestId('tool-use-toggle'))
    fireEvent.click(screen.getByTestId('action-card-header'))
    expect(onOpenNote).toHaveBeenCalledWith('/vault/note.md')
  })

  it('shows streaming indicator when streaming without response', () => {
    const { container } = render(
      <AiMessage userMessage="Ask" actions={[]} isStreaming />,
    )
    expect(container.querySelector('.typing-dot')).toBeTruthy()
  })

  it('does not show streaming indicator when response is present', () => {
    const { container } = render(
      <AiMessage userMessage="Ask" actions={[]} response="Done" isStreaming />,
    )
    expect(container.querySelector('.typing-dot')).toBeNull()
  })

  it('runs assistant message actions', () => {
    const onRegenerate = vi.fn()
    const onFork = vi.fn()
    render(
      <AiMessage
        userMessage="Ask"
        actions={[]}
        messageId="message-1"
        response="Done"
        onFork={onFork}
        onRegenerate={onRegenerate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate response' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy response' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fork chat from here' }))

    expect(onRegenerate).toHaveBeenCalledWith('message-1')
    expect(writeClipboardText).toHaveBeenCalledWith('Done')
    expect(onFork).toHaveBeenCalledWith('message-1')
  })

  it('does not render reasoning block when no reasoning', () => {
    render(<AiMessage userMessage="Ask" actions={[]} />)
    expect(screen.queryByTestId('reasoning-toggle')).toBeNull()
  })

  it('does not render actions when empty array', () => {
    render(<AiMessage userMessage="Ask" actions={[]} />)
    expect(screen.queryByTestId('ai-action-card')).toBeNull()
  })

  it('renders reference pills in user bubble', () => {
    render(
      <AiMessage
        userMessage="Tell me about this"
        references={[
          { title: 'Marco', path: 'person/marco.md', type: 'Person' },
          { title: 'Project X', path: 'project/x.md', type: 'Project' },
        ]}
        actions={[]}
      />,
    )
    const pills = screen.getAllByTestId('message-reference-pill')
    expect(pills).toHaveLength(2)
    expect(pills[0].textContent).toBe('Marco')
    expect(pills[1].textContent).toBe('Project X')
  })

  it('does not render pills when no references', () => {
    render(<AiMessage userMessage="Hello" actions={[]} />)
    expect(screen.queryAllByTestId('message-reference-pill')).toHaveLength(0)
  })

  it('does not render pills when references array is empty', () => {
    render(<AiMessage userMessage="Hello" references={[]} actions={[]} />)
    expect(screen.queryAllByTestId('message-reference-pill')).toHaveLength(0)
  })

  it('calls onOpenNote when a reference pill is clicked', () => {
    const onOpenNote = vi.fn()
    render(
      <AiMessage
        userMessage="Check this"
        references={[{ title: 'Alpha', path: 'note/alpha.md', type: 'Note' }]}
        actions={[]}
        onOpenNote={onOpenNote}
      />,
    )
    fireEvent.click(screen.getByTestId('message-reference-pill'))
    expect(onOpenNote).toHaveBeenCalledWith('note/alpha.md')
  })

  it('expands and collapses action cards independently', () => {
    render(
      <AiMessage
        userMessage="Do"
        actions={[
          { tool: 'search_notes', toolId: 't1', label: 'Searched', status: 'done', input: '{"q":"test"}', output: 'Found 3' },
          { tool: 'create_note', toolId: 't2', label: 'Created', status: 'done', input: '{"title":"x"}' },
        ]}
      />,
    )
    fireEvent.click(screen.getByTestId('tool-use-toggle'))
    const headers = screen.getAllByTestId('action-card-header')
    // Both collapsed initially
    expect(screen.queryByTestId('action-card-details')).toBeNull()
    // Expand first card
    fireEvent.click(headers[0])
    expect(screen.getAllByTestId('action-card-details')).toHaveLength(1)
    // Expand second card too
    fireEvent.click(headers[1])
    expect(screen.getAllByTestId('action-card-details')).toHaveLength(2)
    // Collapse first card
    fireEvent.click(headers[0])
    expect(screen.getAllByTestId('action-card-details')).toHaveLength(1)
  })
})
