import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MARKDOWN_HIGHLIGHT_STYLE } from '../utils/markdownHighlightMarkdown'
import {
  createMarkdownHighlightShortcutExtension,
  isMarkdownHighlightShortcut,
} from './markdownHighlightShortcutExtension'

const { trackEventMock } = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
}))

vi.mock('../lib/telemetry', () => ({
  trackEvent: trackEventMock,
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
    code: 'KeyM',
    ctrlKey: false,
    isComposing: false,
    key: 'M',
    keyCode: 77,
    metaKey: true,
    preventDefault: vi.fn(),
    shiftKey: true,
    stopPropagation: vi.fn(),
    ...options,
  } as unknown as KeyboardEvent
}

function createFixture({ editable = true, composing = false } = {}) {
  let keydownListener: EventListener | null = null
  const view = { composing }
  const editor = {
    _tiptapEditor: { view },
    focus: vi.fn(),
    isEditable: editable,
    prosemirrorView: view,
    toggleStyles: vi.fn(),
  }
  const dom = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'keydown') keydownListener = listener
    }),
  }
  const extension = createMarkdownHighlightShortcutExtension()({ editor: editor as never })

  return {
    dom,
    editor,
    fireKeydown(event = shortcutEvent()) {
      if (!keydownListener) {
        throw new Error('Markdown highlight shortcut extension did not register keydown')
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

describe('createMarkdownHighlightShortcutExtension', () => {
  beforeEach(() => {
    trackEventMock.mockClear()
  })

  it('recognizes Cmd/Ctrl+Shift+M without Alt', () => {
    expect(isMarkdownHighlightShortcut(shortcutEvent())).toBe(true)
    expect(isMarkdownHighlightShortcut(shortcutEvent({ ctrlKey: true, metaKey: false }))).toBe(true)
    expect(isMarkdownHighlightShortcut(shortcutEvent({ altKey: true }))).toBe(false)
    expect(isMarkdownHighlightShortcut(shortcutEvent({ shiftKey: false }))).toBe(false)
    expect(isMarkdownHighlightShortcut(shortcutEvent({ code: 'KeyB', key: 'B' }))).toBe(false)
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

  it('toggles the durable Markdown highlight style from the keyboard shortcut', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown()

    expect(fixture.editor.focus).toHaveBeenCalledWith()
    expect(fixture.editor.toggleStyles).toHaveBeenCalledWith({ [MARKDOWN_HIGHLIGHT_STYLE]: true })
    expect(trackEventMock).toHaveBeenCalledWith('markdown_highlight_shortcut_used', { source: 'keyboard' })
    expect(event.preventDefault).toHaveBeenCalledWith()
    expect(event.stopPropagation).toHaveBeenCalledWith()
  })

  it('ignores composing and read-only editor states', () => {
    const composingFixture = createFixture({ composing: true })
    composingFixture.mount()
    const composingEvent = composingFixture.fireKeydown()
    expect(composingFixture.editor.toggleStyles).not.toHaveBeenCalled()
    expect(composingEvent.preventDefault).not.toHaveBeenCalled()
    expect(trackEventMock).not.toHaveBeenCalled()

    const readonlyFixture = createFixture({ editable: false })
    readonlyFixture.mount()
    const readonlyEvent = readonlyFixture.fireKeydown()
    expect(readonlyFixture.editor.toggleStyles).not.toHaveBeenCalled()
    expect(readonlyEvent.preventDefault).not.toHaveBeenCalled()
    expect(trackEventMock).not.toHaveBeenCalled()
  })
})
