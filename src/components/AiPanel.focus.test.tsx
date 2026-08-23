import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { canEditorClaimFocus, useEditorFocusScope } from '../hooks/editorFocusOwnership'
import { TooltipProvider } from './ui/tooltip'
import { AiPanelView } from './AiPanel'
import type { AiPanelController } from './useAiPanelController'

function EditorFocusTarget() {
  const editorRef = useRef<HTMLDivElement | null>(null)
  useEditorFocusScope(editorRef)

  return (
    <div ref={editorRef}>
      <button type="button" data-testid="delayed-editor-focus-target">Editor</button>
    </div>
  )
}

function idleController(): AiPanelController {
  return {
    agent: {
      messages: [],
      status: 'idle',
      sendMessage: () => Promise.resolve(),
      stopMessage: vi.fn(),
      regenerateMessage: () => Promise.resolve(),
      clearConversation: vi.fn(),
      addLocalMarker: vi.fn(),
    },
    input: '',
    setInput: vi.fn(),
    linkedEntries: [],
    hasContext: false,
    isActive: false,
    permissionMode: 'safe',
    handleSend: vi.fn(),
    handleStop: vi.fn(),
    handleNavigateWikilink: vi.fn(),
    handlePermissionModeChange: vi.fn(),
    handleNewChat: vi.fn(),
  }
}

describe('AI panel focus ownership', () => {
  it('keeps composer focus when a delayed editor retry follows app reactivation typing', () => {
    render(
      <TooltipProvider>
        <EditorFocusTarget />
        <AiPanelView controller={idleController()} onClose={vi.fn()} />
      </TooltipProvider>,
    )
    const input = screen.getByTestId('agent-input')
    const editorTarget = screen.getByTestId('delayed-editor-focus-target')
    input.focus()
    input.textContent = 'f'
    fireEvent.input(input)

    editorTarget.focus()

    expect(document.activeElement).toBe(screen.getByTestId('agent-input'))
    fireEvent.pointerDown(editorTarget)
  })

  it('releases its editor focus claim when the focused panel unmounts', () => {
    const view = render(
      <TooltipProvider>
        <AiPanelView controller={idleController()} onClose={vi.fn()} />
      </TooltipProvider>,
    )
    screen.getByTestId('agent-input').focus()
    expect(canEditorClaimFocus()).toBe(false)

    view.unmount()

    expect(canEditorClaimFocus()).toBe(true)
  })
})
