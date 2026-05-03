import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { VaultEntry } from '../types'
import { queueAiPrompt, requestOpenAiChat } from '../utils/aiPromptBridge'
import { readSelectionRange } from './inlineWikilinkDom'
import { CommandPalette } from './CommandPalette'
import type { CommandAction } from '../hooks/useCommandRegistry'

type NativeDropPayload = {
  type: string
  paths: string[]
  position: { x: number; y: number }
}
type NativeDropHandler = (event: { payload: NativeDropPayload }) => void
const nativeDropState = vi.hoisted(() => ({
  tauriMode: false,
  handlers: {} as Record<string, NativeDropHandler[] | undefined>,
}))

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

vi.mock('../mock-tauri', () => ({
  isTauri: () => nativeDropState.tauriMode,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn((handler: NativeDropHandler) => {
      nativeDropState.handlers['native-drag-drop'] = [
        ...(nativeDropState.handlers['native-drag-drop'] ?? []),
        handler,
      ]
      return Promise.resolve(() => {
        const handlers = nativeDropState.handlers['native-drag-drop']?.filter((candidate) => candidate !== handler) ?? []
        if (handlers.length > 0) nativeDropState.handlers['native-drag-drop'] = handlers
        else delete nativeDropState.handlers['native-drag-drop']
      })
    }),
  }),
}))

vi.mock('../utils/aiPromptBridge', () => ({
  queueAiPrompt: vi.fn(),
  requestOpenAiChat: vi.fn(),
}))

const makeCommand = (overrides: Partial<CommandAction> = {}): CommandAction => ({
  id: 'test-cmd',
  label: 'Test Command',
  group: 'Navigation',
  keywords: [],
  enabled: true,
  shortcut: undefined,
  execute: vi.fn(),
  ...overrides,
})

const commands: CommandAction[] = [
  makeCommand({ id: 'search-notes', label: 'Search Notes', group: 'Navigation', shortcut: '⌘P', keywords: ['find'] }),
  makeCommand({ id: 'create-note', label: 'New Note', group: 'Note', shortcut: '⌘N' }),
  makeCommand({ id: 'commit-push', label: 'Commit & Push', group: 'Git', keywords: ['git', 'sync'] }),
  makeCommand({ id: 'open-settings', label: 'Open Settings', group: 'Settings', shortcut: '⌘,' }),
  makeCommand({ id: 'disabled-cmd', label: 'Disabled Command', group: 'Note', enabled: false }),
]

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
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
  outgoingLinks: [],
  ...overrides,
})

const entries: VaultEntry[] = [
  makeEntry({ path: '/vault/alpha.md', filename: 'alpha.md', title: 'Alpha', isA: 'Project' }),
]

function setSelection(editor: HTMLElement, offset: number) {
  const selection = window.getSelection()
  if (!selection) return

  const targetNode = editor.firstChild ?? editor
  const safeOffset = targetNode.nodeType === Node.TEXT_NODE
    ? Math.min(offset, targetNode.textContent?.length ?? 0)
    : Math.min(offset, targetNode.childNodes.length)

  const range = document.createRange()
  range.setStart(targetNode, safeOffset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function updateAiInput(text: string) {
  const editor = screen.getByTestId('command-palette-ai-input')
  editor.textContent = text
  setSelection(editor, text.length)
  fireEvent.input(editor)
  return editor
}

function resetNativeDropState() {
  nativeDropState.tauriMode = false
  for (const eventName of Object.keys(nativeDropState.handlers)) {
    delete nativeDropState.handlers[eventName]
  }
}

function mockElementRect(element: HTMLElement) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 48,
      width: 400,
      height: 48,
      toJSON: () => ({}),
    }),
  })
}

function emitNativePathDrop(paths: string[]) {
  const handlers = nativeDropState.handlers['native-drag-drop']
  if (!handlers || handlers.length === 0) throw new Error('No native drop handler registered')
  for (const handler of handlers) {
    handler({
      payload: {
        type: 'drop',
        paths,
        position: { x: 20, y: 20 },
      },
    })
  }
}

async function waitForNativePathDropListener() {
  await waitFor(() => {
    expect(nativeDropState.handlers['native-drag-drop']?.length).toBeGreaterThan(0)
  })
}

describe('CommandPalette', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resetNativeDropState()
  })

  afterEach(resetNativeDropState)

  it('renders nothing when closed', () => {
    const { container } = render(
      <CommandPalette open={false} commands={commands} onClose={onClose} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows search input when open', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()
  })

  it('opts the command input out of spellcheck and text correction', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    const input = screen.getByPlaceholderText('Type a command...')

    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(input).toHaveAttribute('autocorrect', 'off')
    expect(input).toHaveAttribute('autocapitalize', 'off')
    expect(input).toHaveAttribute('autocomplete', 'off')
  })

  it('shows all enabled commands grouped by category', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    expect(screen.getByText('Search Notes')).toBeInTheDocument()
    expect(screen.getByText('New Note')).toBeInTheDocument()
    expect(screen.getByText('Commit & Push')).toBeInTheDocument()
    expect(screen.getByText('Open Settings')).toBeInTheDocument()
    // Disabled command should not appear
    expect(screen.queryByText('Disabled Command')).not.toBeInTheDocument()
  })

  it('shows group labels', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    expect(screen.getByText('Navigation')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByText('Git')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })

  it('shows keyboard shortcuts', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    expect(screen.getByText('⌘P')).toBeInTheDocument()
    expect(screen.getByText('⌘N')).toBeInTheDocument()
    expect(screen.getByText('⌘,')).toBeInTheDocument()
  })

  it('filters commands by fuzzy search', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    const input = screen.getByPlaceholderText('Type a command...')
    fireEvent.change(input, { target: { value: 'commit' } })

    expect(screen.getByText('Commit & Push')).toBeInTheDocument()
    expect(screen.queryByText('Search Notes')).not.toBeInTheDocument()
  })

  it('matches by keyword', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    const input = screen.getByPlaceholderText('Type a command...')
    fireEvent.change(input, { target: { value: 'find' } })

    expect(screen.getByText('Search Notes')).toBeInTheDocument()
  })

  it('shows "No matching commands" when no results', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    const input = screen.getByPlaceholderText('Type a command...')
    fireEvent.change(input, { target: { value: 'zzzzzzz' } })

    expect(screen.getByText('No matching commands')).toBeInTheDocument()
  })

  it('localizes command palette chrome', () => {
    render(<CommandPalette open={true} commands={commands} locale="zh-CN" onClose={onClose} />)
    const input = screen.getByPlaceholderText('输入命令...')
    fireEvent.change(input, { target: { value: 'zzzzzzz' } })

    expect(screen.getByText('没有匹配的命令')).toBeInTheDocument()
    expect(screen.getByText('↑↓ 导航')).toBeInTheDocument()
  })

  it('calls onClose when pressing Escape', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('executes command and closes on Enter', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Enter' })

    // First enabled command (Search Notes) should execute
    expect(commands[0].execute).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('navigates with arrow keys and selects with Enter', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })

    // Second enabled command (New Note) should execute
    expect(commands[1].execute).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps a short query keyboard-selectable after ArrowDown and Enter', () => {
    const changeNoteType = makeCommand({
      id: 'change-note-type',
      label: 'Change Note Type…',
      group: 'Note',
    })

    render(
      <CommandPalette
        open={true}
        commands={[
          changeNoteType,
          makeCommand({ id: 'open-settings', label: 'Open Settings', group: 'Settings' }),
        ]}
        onClose={onClose}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('Type a command...'), { target: { value: 'ch' } })
    fireEvent.keyDown(window, { key: 'ArrowDown' })

    const selectedRow = screen.getByText('Change Note Type…').closest('[data-selected]')
    expect(selectedRow).toHaveAttribute('data-selected', 'true')

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(changeNoteType.execute).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not go below the last item', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)

    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(window, { key: 'ArrowDown' })
    }
    fireEvent.keyDown(window, { key: 'Enter' })

    // Should select last enabled command (Open Settings)
    expect(commands[3].execute).toHaveBeenCalled()
  })

  it('does not go above first item', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'ArrowUp' })
    fireEvent.keyDown(window, { key: 'Enter' })

    // Should still select first command
    expect(commands[0].execute).toHaveBeenCalled()
  })

  it('calls onClose when clicking backdrop', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)

    const backdrop = screen.getByPlaceholderText('Type a command...').closest('.fixed')!
    fireEvent.click(backdrop)

    expect(onClose).toHaveBeenCalled()
  })

  it('executes command when clicking an item', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    fireEvent.click(screen.getByText('Commit & Push'))

    expect(commands[2].execute).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('shows footer hints', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    expect(screen.getByText('↑↓ navigate')).toBeInTheDocument()
    expect(screen.getByText('↵ select')).toBeInTheDocument()
    expect(screen.getByText('esc close')).toBeInTheDocument()
  })

  it('switches into AI mode when the query starts with a leading space', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('Type a command...'), { target: { value: ' ' } })

    expect(screen.getByTestId('command-palette-ai-input')).toBeInTheDocument()
    expect(screen.getAllByText('Ask Claude Code').length).toBeGreaterThan(0)
    expect(screen.queryByText('Search Notes')).not.toBeInTheDocument()
  })

  it('inserts Tauri native folder drops into the command query input', async () => {
    nativeDropState.tauriMode = true
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)

    const input = screen.getByPlaceholderText('Type a command...') as HTMLInputElement
    mockElementRect(input)
    input.focus()
    await waitForNativePathDropListener()

    act(() => {
      emitNativePathDrop(['/Users/test/Projects'])
    })

    await waitFor(() => {
      expect(input).toHaveValue('/Users/test/Projects')
    })
  })

  it('focuses the AI editor immediately when the leading space triggers AI mode', () => {
    render(<CommandPalette open={true} commands={commands} entries={entries} onClose={onClose} />)

    const input = screen.getByPlaceholderText('Type a command...')
    input.focus()
    fireEvent.change(input, { target: { value: ' ' } })

    expect(screen.getByTestId('command-palette-ai-input')).toHaveFocus()
  })

  it('places the AI editor caret after the trigger space on mode entry', () => {
    render(<CommandPalette open={true} commands={commands} entries={entries} onClose={onClose} />)

    const input = screen.getByPlaceholderText('Type a command...')
    input.focus()
    fireEvent.change(input, { target: { value: ' ' } })

    const editor = screen.getByTestId('command-palette-ai-input') as HTMLDivElement
    expect(editor).toHaveFocus()
    expect(readSelectionRange(editor)).toEqual({ start: 1, end: 1 })
  })

  it('returns to command mode when the leading space is deleted', () => {
    render(
      <CommandPalette open={true} commands={commands} entries={entries} onClose={onClose} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Type a command...'), { target: { value: ' ' } })
    updateAiInput('new')

    const input = screen.getByPlaceholderText('Type a command...') as HTMLInputElement
    expect(screen.queryByTestId('command-palette-ai-input')).toBeNull()
    expect(input.value).toBe('new')
    expect(screen.getByText('New Note')).toBeInTheDocument()
  })

  it('queues a stripped AI prompt and closes on Enter in AI mode', () => {
    render(
      <CommandPalette open={true} commands={commands} entries={entries} onClose={onClose} />,
    )

    fireEvent.change(screen.getByPlaceholderText('Type a command...'), { target: { value: ' ' } })
    const editor = updateAiInput(' hello world')
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(queueAiPrompt).toHaveBeenCalledWith('hello world', [])
    expect(requestOpenAiChat).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes without queueing when AI mode only contains the trigger space', () => {
    render(<CommandPalette open={true} commands={commands} onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText('Type a command...'), { target: { value: ' ' } })
    fireEvent.keyDown(screen.getByTestId('command-palette-ai-input'), { key: 'Enter' })

    expect(queueAiPrompt).not.toHaveBeenCalled()
    expect(requestOpenAiChat).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  describe('relevance ranking', () => {
    const relevanceCommands: CommandAction[] = [
      makeCommand({ id: 'create-note', label: 'New Note', group: 'Note' }),
      makeCommand({ id: 'toggle-raw', label: 'Toggle Raw Editor', group: 'View' }),
      makeCommand({ id: 'search-notes', label: 'Search Notes', group: 'Navigation' }),
    ]

    function getVisibleLabels() {
      return screen.getAllByText(
        (_content, el) =>
          el?.tagName === 'SPAN' &&
          el.classList.contains('text-foreground') &&
          !!el.textContent,
      ).map(el => el.textContent)
    }

    it('shows only the relevant raw command for query "raw"', () => {
      render(<CommandPalette open={true} commands={relevanceCommands} onClose={onClose} />)
      fireEvent.change(screen.getByPlaceholderText('Type a command...'), { target: { value: 'raw' } })

      const labels = getVisibleLabels()
      expect(labels).toEqual(['Toggle Raw Editor'])
    })

    it('ranks "New Note" first for query "new note"', () => {
      render(<CommandPalette open={true} commands={relevanceCommands} onClose={onClose} />)
      fireEvent.change(screen.getByPlaceholderText('Type a command...'), { target: { value: 'new note' } })

      const labels = getVisibleLabels()
      expect(labels[0]).toBe('New Note')
    })

    it('preserves default section order with empty query', () => {
      render(<CommandPalette open={true} commands={relevanceCommands} onClose={onClose} />)

      const groupHeaders = screen.getAllByText(
        (_content, el) =>
          el?.tagName === 'DIV' &&
          el.classList.contains('text-[11px]') &&
          el.classList.contains('font-medium') &&
          !!el.textContent,
      ).map(el => el.textContent)

      // Default order: Navigation < Note < View
      expect(groupHeaders).toEqual(['Navigation', 'Note', 'View'])
    })
  })
})
