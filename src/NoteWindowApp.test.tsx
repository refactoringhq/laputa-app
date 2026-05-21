import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NoteWindowApp from './NoteWindowApp'
import type { NoteStatus, VaultEntry } from './types'

type MockEditorProps = {
  activeTabPath: string | null
  entries: VaultEntry[]
  getNoteStatus?: (path: string) => NoteStatus
  onContentChange?: (path: string, content: string) => void
  tabs: Array<{ entry: VaultEntry; content: string }>
  vaultPath?: string
  vaultPaths?: string[]
}

const mocks = vi.hoisted(() => ({
  editorProps: [] as MockEditorProps[],
  invoke: vi.fn(),
  setTitle: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ setTitle: mocks.setTitle }),
}))

vi.mock('./mock-tauri', () => ({
  isTauri: () => true,
  mockInvoke: vi.fn(),
}))

vi.mock('./components/Editor', () => ({
  Editor: (props: MockEditorProps) => {
    mocks.editorProps.push(props)
    return (
      <button
        data-testid="mock-note-window-editor"
        type="button"
        onClick={() => props.onContentChange?.(props.activeTabPath ?? '', 'Updated content')}
      >
        {props.tabs[0]?.content}
      </button>
    )
  },
}))

vi.mock('./components/Toast', () => ({
  Toast: ({ message }: { message: string | null }) => (
    <div data-testid="mock-toast">{message}</div>
  ),
}))

function makeEntry(): VaultEntry {
  return {
    path: 'Notes/entry.md',
    filename: 'entry.md',
    title: 'Entry',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 1_700_000_000,
    createdAt: null,
    fileSize: 256,
    snippet: '',
    wordCount: 10,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
  }
}

function setSearch(search: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, search },
  })
}

describe('NoteWindowApp', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(mocks.warn)
    mocks.editorProps.length = 0
    setSearch('?window=note&path=%2Fvault%2FNotes%2Fentry.md&vault=%2Fvault&title=Entry')
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'sync_vault_asset_scope_for_window') return undefined
      if (command === 'reload_vault_entry') return makeEntry()
      if (command === 'get_note_content') return '# Entry'
      if (command === 'save_note_content') return undefined
      throw new Error(`Unexpected command: ${command}`)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads one note without booting the full vault and saves editor changes', async () => {
    render(<NoteWindowApp />)
    const editor = await screen.findByTestId('mock-note-window-editor')

    expect(editor).toHaveTextContent('# Entry')
    expect(mocks.editorProps.at(-1)).toEqual(expect.objectContaining({
      activeTabPath: 'Notes/entry.md',
      vaultPath: '/vault',
      vaultPaths: ['/vault'],
    }))
    expect(mocks.invoke).not.toHaveBeenCalledWith('list_vault', expect.anything())

    vi.useFakeTimers()
    fireEvent.click(editor)
    expect(mocks.editorProps.at(-1)?.getNoteStatus?.('Notes/entry.md')).toBe('unsaved')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    vi.useRealTimers()

    expect(mocks.invoke).toHaveBeenCalledWith('save_note_content', {
      path: 'Notes/entry.md',
      content: 'Updated content',
      vaultPath: '/vault',
    })
  })
})
