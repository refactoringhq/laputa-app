import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EditorRightPanel } from './EditorRightPanel'
import type { VaultEntry } from '../types'
import { bindVaultConfigStore, resetVaultConfigStore } from '../utils/vaultConfigStore'

vi.mock('../hooks/useCliAiAgent', async () => {
  const React = await import('react')

  return {
    useCliAiAgent: () => {
      const [messages, setMessages] = React.useState<Array<{
        id: string
        userMessage: string
        actions: unknown[]
        response?: string
        localMarker?: string
      }>>([])

      return {
        messages,
        status: 'idle',
        sendMessage: (text: string) => {
          setMessages([{
            id: 'mock-session-message',
            userMessage: text,
            actions: [],
            response: 'Mock response',
          }])
        },
        clearConversation: () => setMessages([]),
        addLocalMarker: (text: string) => {
          setMessages([{
            id: 'mock-local-marker',
            userMessage: '',
            actions: [],
            localMarker: text,
          }])
        },
      }
    },
  }
})

const entry: VaultEntry = {
  path: '/vault/note/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  owner: null,
  cadence: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: false,
}

function editorRightPanel(showAIChat: boolean) {
  return (
    <EditorRightPanel
      showAIChat={showAIChat}
      showTableOfContents={false}
      inspectorCollapsed
      inspectorWidth={320}
      editor={{} as never}
      inspectorEntry={entry}
      inspectorContent="Active note content"
      entries={[entry]}
      gitHistory={[]}
      vaultPath="/tmp/vault"
      onToggleInspector={vi.fn()}
      onToggleAIChat={vi.fn()}
      onNavigateWikilink={vi.fn()}
      onViewCommitDiff={vi.fn()}
    />
  )
}

function renderRightPanel(showAIChat: boolean) {
  return rtlRender(
    editorRightPanel(showAIChat),
    { wrapper: TooltipProvider },
  )
}

describe('EditorRightPanel', () => {
  beforeEach(() => {
    resetVaultConfigStore()
    bindVaultConfigStore({
      zoom: null,
      view_mode: null,
      editor_mode: null,
      note_layout: null,
      tag_colors: null,
      status_colors: null,
      property_display_modes: null,
      inbox: null,
      allNotes: null,
      ai_agent_permission_mode: 'safe',
    }, vi.fn())
  })

  it('preserves the AI panel transcript across close and reopen', () => {
    const view = renderRightPanel(true)

    const input = screen.getByTestId('agent-input')
    input.textContent = 'keep this session'
    fireEvent.input(input)
    fireEvent.click(screen.getByTestId('agent-send'))

    expect(screen.getByText('keep this session')).toBeTruthy()
    expect(screen.getByText('Mock response')).toBeTruthy()

    view.rerender(editorRightPanel(false))
    expect(screen.queryByTestId('ai-panel')).toBeNull()

    view.rerender(editorRightPanel(true))

    expect(screen.getByText('keep this session')).toBeTruthy()
    expect(screen.getByText('Mock response')).toBeTruthy()
  })
})
