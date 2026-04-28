import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { WikilinkChatInput } from './WikilinkChatInput'
import { extractDroppedPathText } from './inlineWikilinkDropText'
import {
  UNSUPPORTED_INLINE_PASTE_MESSAGE,
} from './InlineWikilinkInput'
import { isInsertBeforeInput } from './inlineWikilinkBeforeInput'
import type { VaultEntry } from '../types'

type NativeDropPayload = {
  type: string
  paths: string[]
  position: { x: number; y: number }
}
type NativeDropHandler = (event: { payload: NativeDropPayload }) => void
const nativeDropState = vi.hoisted(() => ({
  tauriMode: false,
  handlers: {} as Record<string, NativeDropHandler | undefined>,
}))

vi.mock('../mock-tauri', () => ({
  isTauri: () => nativeDropState.tauriMode,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: vi.fn((handler: NativeDropHandler) => {
      nativeDropState.handlers['native-drag-drop'] = handler
      return Promise.resolve(() => {
        delete nativeDropState.handlers['native-drag-drop']
      })
    }),
  }),
}))

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
  makeEntry({ path: '/vault/alpha.md', title: 'Alpha', filename: 'alpha.md', isA: 'Project' }),
  makeEntry({ path: '/vault/beta.md', title: 'Beta', filename: 'beta.md', isA: 'Person', aliases: ['BLT'] }),
  makeEntry({ path: '/vault/gamma.md', title: 'Gamma', filename: 'gamma.md' }),
]

function Controlled({
  onSend,
  onUnsupportedPaste,
  disabled = false,
  placeholder,
  onDraftChange,
}: {
  onSend?: (text: string, refs: Array<{ title: string; path: string; type: string | null }>) => void
  onUnsupportedPaste?: (message: string) => void
  disabled?: boolean
  placeholder?: string
  onDraftChange?: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const handleChange = (nextValue: string) => {
    onDraftChange?.(nextValue)
    setValue(nextValue)
  }

  return (
    <WikilinkChatInput
      entries={entries}
      value={value}
      onChange={handleChange}
      onSend={onSend ?? vi.fn()}
      onUnsupportedPaste={onUnsupportedPaste}
      disabled={disabled}
      placeholder={placeholder}
    />
  )
}

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

function updateEditorText(text: string) {
  const editor = screen.getByTestId('agent-input')
  editor.focus()
  fireEvent.focus(editor)
  editor.textContent = text
  setSelection(editor, text.length)
  fireEvent.input(editor)
}

function clickFirstSuggestion() {
  const rows = screen.getByTestId('wikilink-menu').querySelectorAll('[class*="cursor-pointer"]')
  expect(rows.length).toBeGreaterThan(0)
  fireEvent.click(rows[0])
}

function fireComposingKeyDown(editor: HTMLElement, key: string) {
  const event = createEvent.keyDown(editor, {
    key,
    keyCode: 229,
    which: 229,
  })

  Object.defineProperty(event, 'isComposing', {
    configurable: true,
    value: true,
  })

  fireEvent(editor, event)
}

function createFileLikeDataTransfer({
  plainText = '',
  uriList = '',
}: {
  plainText?: string
  uriList?: string
}) {
  return {
    getData: vi.fn((type: string) => {
      if (type === 'text/plain') return plainText
      if (type === 'text/uri-list') return uriList
      return ''
    }),
    files: [new File(['folder'], 'Projects')],
    items: [{ kind: 'file', type: '' }],
  }
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

function emitNativePathDrop(paths: string[], position = { x: 20, y: 20 }) {
  const handler = nativeDropState.handlers['native-drag-drop']
  if (!handler) throw new Error('No native drop handler registered')
  handler({
    payload: {
      type: 'drop',
      paths,
      position,
    },
  })
}

async function waitForNativePathDropListener() {
  await waitFor(() => {
    expect(nativeDropState.handlers['native-drag-drop']).toBeDefined()
  })
}

describe('WikilinkChatInput', () => {
  beforeEach(resetNativeDropState)
  afterEach(resetNativeDropState)

  it('renders the placeholder overlay for an empty draft', () => {
    render(<Controlled placeholder="Ask something..." />)
    expect(screen.getByText('Ask something...')).toBeInTheDocument()
    expect(screen.getByTestId('agent-input')).toHaveAttribute('aria-placeholder', 'Ask something...')
  })

  it('calls onChange when the draft changes', () => {
    const onChange = vi.fn()
    render(
      <WikilinkChatInput entries={entries} value="" onChange={onChange} onSend={vi.fn()} />,
    )

    updateEditorText('hello')
    expect(onChange).toHaveBeenCalledWith('hello')
  })

  it('shows wikilink suggestions after typing [[', () => {
    render(<Controlled />)
    updateEditorText('[[a')

    const menu = screen.getByTestId('wikilink-menu')
    expect(menu.textContent).toContain('Alpha')
  })

  it('matches suggestions by alias', () => {
    render(<Controlled />)
    updateEditorText('[[BLT')

    expect(screen.getByTestId('wikilink-menu').textContent).toContain('Beta')
  })

  it('renders selected wikilinks inline instead of in a separate pill strip', () => {
    render(<Controlled />)
    updateEditorText('edit my [[alp')
    clickFirstSuggestion()

    expect(screen.queryByTestId('reference-pill')).toBeNull()
    expect(screen.getByTestId('inline-wikilink-chip')).toBeInTheDocument()
    expect(screen.getByTestId('agent-input').textContent).toContain('Alpha')
  })

  it('selects a suggestion with Enter before sending the draft', () => {
    const onSend = vi.fn()
    render(<Controlled onSend={onSend} />)
    updateEditorText('edit my [[alp')

    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter' })

    expect(screen.getByTestId('inline-wikilink-chip')).toBeInTheDocument()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not hijack Enter while IME composition is active', async () => {
    const onDraftChange = vi.fn()
    const onSend = vi.fn()
    render(<Controlled onDraftChange={onDraftChange} onSend={onSend} />)

    const editor = screen.getByTestId('agent-input')
    fireEvent.focus(editor)
    fireEvent.compositionStart(editor)
    editor.textContent = 'ni'
    setSelection(editor, 2)
    fireEvent.input(editor)

    expect(onDraftChange).not.toHaveBeenCalled()

    fireComposingKeyDown(editor, 'Enter')
    expect(onSend).not.toHaveBeenCalled()

    editor.textContent = '你'
    setSelection(editor, 1)
    fireEvent.compositionEnd(editor)

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith('你')
    })
    expect(editor.textContent).toContain('你')
  })

  it('does not select wikilink suggestions while IME composition is active', () => {
    render(<Controlled />)
    updateEditorText('[[a')

    const editor = screen.getByTestId('agent-input')
    fireEvent.compositionStart(editor)
    fireComposingKeyDown(editor, 'Enter')

    expect(screen.queryByTestId('inline-wikilink-chip')).toBeNull()
    expect(screen.getByTestId('wikilink-menu').textContent).toContain('Alpha')
  })

  it('clears IME-injected stray text nodes after composition ends', async () => {
    const onDraftChange = vi.fn()
    render(<Controlled onDraftChange={onDraftChange} />)
    const initialEditor = screen.getByTestId('agent-input') as HTMLDivElement
    initialEditor.focus()

    fireEvent.compositionStart(initialEditor)
    initialEditor.appendChild(document.createTextNode('你'))
    fireEvent.input(initialEditor)
    fireEvent.compositionEnd(initialEditor)

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith('你')
    })
    await waitFor(() => {
      const editor = screen.getByTestId('agent-input') as HTMLDivElement
      expect(editor.textContent).toBe('你')
    })
  })

  it('does not duplicate syllables across consecutive IME compositions', async () => {
    const onDraftChange = vi.fn()
    render(<Controlled onDraftChange={onDraftChange} />)

    const firstEditor = screen.getByTestId('agent-input') as HTMLDivElement
    firstEditor.focus()
    fireEvent.compositionStart(firstEditor)
    firstEditor.appendChild(document.createTextNode('안'))
    fireEvent.input(firstEditor)
    fireEvent.compositionEnd(firstEditor)

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenLastCalledWith('안')
    })

    const secondEditor = screen.getByTestId('agent-input') as HTMLDivElement
    secondEditor.focus()
    fireEvent.compositionStart(secondEditor)
    secondEditor.appendChild(document.createTextNode('녕'))
    fireEvent.input(secondEditor)
    fireEvent.compositionEnd(secondEditor)

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenLastCalledWith('안녕')
    })
    expect(screen.getByTestId('agent-input').textContent).toBe('안녕')
  })

  it('does not steal focus back if it was moved elsewhere during composition end', async () => {
    const onDraftChange = vi.fn()
    render(
      <>
        <Controlled onDraftChange={onDraftChange} />
        <button data-testid="other-target">Other</button>
      </>,
    )
    const initialEditor = screen.getByTestId('agent-input') as HTMLDivElement
    const otherTarget = screen.getByTestId('other-target') as HTMLButtonElement
    initialEditor.focus()

    fireEvent.compositionStart(initialEditor)
    initialEditor.appendChild(document.createTextNode('你'))
    fireEvent.input(initialEditor)

    otherTarget.focus()
    fireEvent.compositionEnd(initialEditor)

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith('你')
    })
    expect(document.activeElement).toBe(otherTarget)
  })

  it('does not reset the DOM selection while IME composition is active', () => {
    const removeAllRanges = vi.spyOn(Selection.prototype, 'removeAllRanges')
    render(<Controlled />)
    const editor = screen.getByTestId('agent-input') as HTMLDivElement
    editor.focus()

    fireEvent.compositionStart(editor)
    editor.appendChild(document.createTextNode('ni'))
    setSelection(editor, 2)

    removeAllRanges.mockClear()
    fireEvent.keyUp(editor)
    fireEvent.click(editor)
    fireEvent.mouseUp(editor)

    expect(removeAllRanges).not.toHaveBeenCalled()
    expect(editor.textContent).toContain('ni')

    removeAllRanges.mockRestore()
  })

  it('lets committed composed characters reach the native input pipeline once', () => {
    const onDraftChange = vi.fn()
    render(<Controlled onDraftChange={onDraftChange} />)
    const editor = screen.getByTestId('agent-input')
    editor.focus()

    const portugueseText = 'á é í ç ã õ'
    const accentedKey = createEvent.keyDown(editor, { key: 'á' })
    fireEvent(editor, accentedKey)
    expect(accentedKey.defaultPrevented).toBe(false)

    editor.textContent = portugueseText
    setSelection(editor, portugueseText.length)
    fireEvent.input(editor)
    expect(onDraftChange).toHaveBeenLastCalledWith(portugueseText)

    const cjkKey = createEvent.keyDown(editor, { key: '你' })
    fireEvent(editor, cjkKey)
    expect(cjkKey.defaultPrevented).toBe(false)

    editor.textContent = `${portugueseText}你`
    setSelection(editor, portugueseText.length + 1)
    fireEvent.input(editor)
    expect(onDraftChange).toHaveBeenLastCalledWith(`${portugueseText}你`)
  })

  it('deletes an inline chip with a single Backspace', () => {
    render(<Controlled />)
    updateEditorText('edit my [[alp')
    clickFirstSuggestion()

    const editor = screen.getByTestId('agent-input')
    fireEvent.keyDown(editor, { key: 'Backspace' })

    expect(screen.queryByTestId('inline-wikilink-chip')).toBeNull()
  })

  it('submits serialized wikilink text and resolved references', () => {
    const onSend = vi.fn()
    render(<Controlled onSend={onSend} />)

    updateEditorText('edit my [[alpha]] essay')
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter' })

    expect(onSend).toHaveBeenCalledWith('edit my [[alpha]] essay', [
      { title: 'Alpha', path: '/vault/alpha.md', type: 'Project' },
    ])
  })

  it('does not send on Shift+Enter', () => {
    const onSend = vi.fn()
    render(<Controlled onSend={onSend} />)

    updateEditorText('hello')
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter', shiftKey: true })

    expect(onSend).not.toHaveBeenCalled()
  })

  it('inserts one controlled newline on Shift+Enter without duplicating the draft', () => {
    const onDraftChange = vi.fn()
    render(<Controlled onDraftChange={onDraftChange} />)

    updateEditorText('first line')
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter', shiftKey: true })

    expect(onDraftChange).toHaveBeenLastCalledWith('first line\n')
    expect(screen.getByTestId('agent-input').textContent).toBe('first line\n')

    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter', shiftKey: true })

    expect(onDraftChange).toHaveBeenLastCalledWith('first line\n\n')
    expect(screen.getByTestId('agent-input').textContent).toBe('first line\n\n')
  })

  it('inserts one controlled newline from native insertLineBreak beforeinput', () => {
    const onDraftChange = vi.fn()
    render(<Controlled onDraftChange={onDraftChange} />)

    updateEditorText('first line')
    const editor = screen.getByTestId('agent-input')
    const beforeInputEvent = new Event('beforeinput', {
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(beforeInputEvent, 'inputType', {
      value: 'insertLineBreak',
    })

    fireEvent(editor, beforeInputEvent)

    expect(beforeInputEvent.defaultPrevented).toBe(true)
    expect(onDraftChange).toHaveBeenLastCalledWith('first line\n')
    expect(screen.getByTestId('agent-input').textContent).toBe('first line\n')
  })

  it('submits a multi-line draft with normal Enter after Shift+Enter', () => {
    const onSend = vi.fn()
    render(<Controlled onSend={onSend} />)

    updateEditorText('first line')
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter', shiftKey: true })

    const editor = screen.getByTestId('agent-input')
    editor.textContent = 'first line\nsecond line'
    setSelection(editor, 'first line\nsecond line'.length)
    fireEvent.input(editor)
    fireEvent.keyDown(screen.getByTestId('agent-input'), { key: 'Enter' })

    expect(onSend).toHaveBeenCalledWith('first line\nsecond line', [])
  })

  it('marks the editor disabled when disabled is true', () => {
    render(<Controlled disabled />)

    const editor = screen.getByTestId('agent-input')
    expect(editor).toHaveAttribute('contenteditable', 'false')
    expect(editor).toHaveAttribute('aria-disabled', 'true')
  })

  it('rejects pasted images without freezing the editor', () => {
    const onUnsupportedPaste = vi.fn()
    render(<Controlled onUnsupportedPaste={onUnsupportedPaste} />)

    const editor = screen.getByTestId('agent-input')
    const clipboardData = {
      getData: vi.fn(() => ''),
      files: [new File(['image'], 'paste.png', { type: 'image/png' })],
      items: [{ kind: 'file', type: 'image/png' }],
    }

    fireEvent.paste(editor, { clipboardData })

    expect(onUnsupportedPaste).toHaveBeenCalledWith(UNSUPPORTED_INLINE_PASTE_MESSAGE)

    updateEditorText('still works')
    expect(editor.textContent).toContain('still works')
  })

  it('extracts dropped folder paths from text/plain payloads', () => {
    expect(extractDroppedPathText(
      createFileLikeDataTransfer({
        plainText: '/Users/test/Projects',
      }) as DataTransfer,
    )).toBe('/Users/test/Projects')
  })

  it('falls back to file URLs exposed through uri lists', () => {
    expect(extractDroppedPathText(
      createFileLikeDataTransfer({
        uriList: 'file:///Users/test/My%20Folder',
      }) as DataTransfer,
    )).toBe('"/Users/test/My Folder"')
  })

  it('inserts Tauri native folder drops into the AI composer', async () => {
    nativeDropState.tauriMode = true
    const onDraftChange = vi.fn()
    render(<Controlled onDraftChange={onDraftChange} />)

    const editor = screen.getByTestId('agent-input') as HTMLDivElement
    mockElementRect(editor)
    await waitForNativePathDropListener()
    updateEditorText('Open ')
    editor.focus()
    onDraftChange.mockClear()

    act(() => {
      emitNativePathDrop(['/Users/test/My Folder'])
    })

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith('Open "/Users/test/My Folder"')
    })
    await waitFor(() => {
      expect(screen.getByTestId('agent-input').textContent).toContain('/Users/test/My Folder')
    })
  })

  it('accepts Tauri native folder drops for the focused AI composer even when native coordinates miss', async () => {
    nativeDropState.tauriMode = true
    const onDraftChange = vi.fn()
    render(<Controlled onDraftChange={onDraftChange} />)

    const editor = screen.getByTestId('agent-input') as HTMLDivElement
    mockElementRect(editor)
    await waitForNativePathDropListener()
    updateEditorText('Open ')
    onDraftChange.mockClear()

    act(() => {
      emitNativePathDrop(['/Users/test/Projects'], { x: 900, y: 900 })
    })

    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalledWith('Open /Users/test/Projects')
    })
  })

  it('treats missing inputType as a non-insert beforeinput event', () => {
    expect(() => isInsertBeforeInput({} as InputEvent)).not.toThrow()
    expect(isInsertBeforeInput({} as InputEvent)).toBe(false)
    expect(isInsertBeforeInput({ inputType: 42 })).toBe(false)
    expect(isInsertBeforeInput({ inputType: 'insertFromPaste' } as InputEvent)).toBe(true)
  })

  it('ignores beforeinput events without inputType instead of crashing', () => {
    render(<Controlled />)

    const editor = screen.getByTestId('agent-input')
    const beforeInputEvent = new Event('beforeinput', {
      bubbles: true,
      cancelable: true,
    })

    expect(() => fireEvent(editor, beforeInputEvent)).not.toThrow()

    updateEditorText('still works')
    expect(editor.textContent).toContain('still works')
  })

  it('ignores beforeinput events with non-string inputType instead of calling startsWith', () => {
    render(<Controlled />)

    const editor = screen.getByTestId('agent-input')
    const startsWith = vi.fn(() => true)
    const beforeInputEvent = new Event('beforeinput', {
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(beforeInputEvent, 'inputType', {
      value: { startsWith },
    })

    expect(() => fireEvent(editor, beforeInputEvent)).not.toThrow()
    expect(startsWith).not.toHaveBeenCalled()

    updateEditorText('still works')
    expect(editor.textContent).toContain('still works')
  })

  it('recovers if unsupported media lands in the editor DOM', async () => {
    const onUnsupportedPaste = vi.fn()
    render(<Controlled onUnsupportedPaste={onUnsupportedPaste} />)

    const editor = screen.getByTestId('agent-input')
    editor.innerHTML = '<img alt="paste" src="data:image/png;base64,abc" />'

    fireEvent.input(editor)

    expect(onUnsupportedPaste).toHaveBeenCalledWith(UNSUPPORTED_INLINE_PASTE_MESSAGE)
    await waitFor(() => {
      expect(screen.getByTestId('agent-input').querySelector('img')).toBeNull()
    })

    updateEditorText('still works')
    expect(screen.getByTestId('agent-input').textContent).toContain('still works')
  })
})
