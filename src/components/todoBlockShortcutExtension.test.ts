import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTodoBlockShortcutExtension,
  isTodoBlockShortcut,
} from './todoBlockShortcutExtension'
import { trackEvent } from '../lib/telemetry'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

type ShortcutEventOptions = {
  altKey?: boolean
  code?: string
  ctrlKey?: boolean
  isComposing?: boolean
  key?: string
  keyCode?: number
  metaKey?: boolean
  shiftKey?: boolean
}

function shortcutEvent(options: ShortcutEventOptions = {}) {
  return {
    altKey: false,
    code: 'KeyT',
    ctrlKey: false,
    isComposing: false,
    key: 't',
    keyCode: 84,
    metaKey: true,
    preventDefault: vi.fn(),
    shiftKey: false,
    stopPropagation: vi.fn(),
    ...options,
  } as unknown as KeyboardEvent
}

function createFixture({ editable = true, composing = false } = {}) {
  let keydownListener: EventListener | null = null
  const block = {
    id: 'paragraph-block',
    type: 'paragraph',
    props: {},
  }
  const view = { composing }
  const editor = {
    _tiptapEditor: { view },
    focus: vi.fn(),
    getBlock: vi.fn(() => block),
    getTextCursorPosition: vi.fn(() => ({ block })),
    isEditable: editable,
    prosemirrorView: view,
    transact: vi.fn((callback: () => void) => callback()),
    updateBlock: vi.fn(),
  }
  const dom = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'keydown') keydownListener = listener
    }),
  }
  const extension = createTodoBlockShortcutExtension()({ editor: editor as never })

  return {
    dom,
    editor,
    fireKeydown(event = shortcutEvent()) {
      if (!keydownListener) {
        throw new Error('Todo block shortcut extension did not register keydown')
      }
      keydownListener(event)
      return event
    },
    mount() {
      const controller = new AbortController()
      extension.mount?.({
        dom: dom as never,
        root: document,
        signal: controller.signal,
      })
      return controller
    },
  }
}

describe('createTodoBlockShortcutExtension', () => {
  beforeEach(() => {
    vi.mocked(trackEvent).mockClear()
  })

  it('recognizes platform Mod+T without Alt or Shift', () => {
    expect(isTodoBlockShortcut(shortcutEvent(), 'mac')).toBe(true)
    expect(isTodoBlockShortcut(shortcutEvent({ ctrlKey: true, metaKey: false }), 'non-mac')).toBe(true)
    expect(isTodoBlockShortcut(shortcutEvent({ altKey: true }), 'mac')).toBe(false)
    expect(isTodoBlockShortcut(shortcutEvent({ shiftKey: true }), 'mac')).toBe(false)
    expect(isTodoBlockShortcut(shortcutEvent({ code: 'KeyB', key: 'b' }), 'mac')).toBe(false)
    expect(isTodoBlockShortcut(shortcutEvent({ ctrlKey: true }), 'mac')).toBe(false)
  })

  it('registers a capture-phase keydown listener when the editor mounts', () => {
    const fixture = createFixture()

    fixture.mount()

    expect(fixture.dom.addEventListener).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
      expect.objectContaining({
        capture: true,
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('toggles the focused block through the shared block type command', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown(shortcutEvent({ ctrlKey: true, metaKey: false }))

    expect(fixture.editor.focus).toHaveBeenCalledWith()
    expect(fixture.editor.updateBlock).toHaveBeenCalledWith('paragraph-block', expect.objectContaining({
      type: 'checkListItem',
    }))
    expect(trackEvent).toHaveBeenCalledWith('editor_block_type_changed', {
      block_type: 'checkListItem',
      source: 'keyboard_shortcut',
    })
    expect(event.preventDefault).toHaveBeenCalledWith()
    expect(event.stopPropagation).toHaveBeenCalledWith()
  })

  it('ignores composing and read-only editor states', () => {
    const composingFixture = createFixture({ composing: true })
    composingFixture.mount()
    composingFixture.fireKeydown()
    expect(composingFixture.editor.updateBlock).not.toHaveBeenCalled()

    const readonlyFixture = createFixture({ editable: false })
    readonlyFixture.mount()
    readonlyFixture.fireKeydown()
    expect(readonlyFixture.editor.updateBlock).not.toHaveBeenCalled()
  })
})
