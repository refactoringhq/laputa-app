import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { AiPanelMessageHistory } from './AiPanelChrome'

const aiMessageRender = vi.hoisted(() => vi.fn())

vi.mock('./AiMessage', () => ({
  AiMessage: (props: { id?: string; response: string }) => {
    aiMessageRender(props.id)
    return <div data-testid="ai-message">{props.response}</div>
  },
}))

const noop = () => {}

function HistoryRerenderHarness() {
  const [draft, setDraft] = useState('')
  const [messages] = useState([{
    userMessage: 'Explain the note',
    actions: [],
    response: 'Here is a long answer with [[Test Note]].',
    id: 'msg-stable',
  }])

  return (
    <>
      <button type="button" onClick={() => setDraft('typing')}>type</button>
      <span data-testid="draft">{draft}</span>
      <AiPanelMessageHistory
        agentLabel="Claude Code"
        agentReadiness="ready"
        messages={messages}
        isActive={false}
        onOpenNote={noop}
        onNavigateWikilink={noop}
        hasContext
      />
    </>
  )
}

describe('AiPanelChrome performance', () => {
  it('keeps stable message history from re-rendering while composer state changes', () => {
    render(<HistoryRerenderHarness />)
    expect(screen.getByTestId('ai-message')).toHaveTextContent('Here is a long answer')
    expect(aiMessageRender).toHaveBeenCalledTimes(1)
    aiMessageRender.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'type' }))

    expect(screen.getByTestId('draft')).toHaveTextContent('typing')
    expect(aiMessageRender).not.toHaveBeenCalled()
  })
})
