import { describe, expect, it, vi } from 'vitest'
import { trackEvent } from '../lib/telemetry'
import {
  createRichEditorCodeBlockShortcutExtension,
  isCodeBlockCreationShortcut,
} from './richEditorCodeBlockShortcutExtension'

vi.mock('../lib/telemetry', () => ({ trackEvent: vi.fn() }))
vi.mock('../utils/platform', () => ({ isMac: () => true }))

type KeyListener = (event: KeyboardEvent) => void

function keyboardEvent(options: Partial<KeyboardEvent> = {}) {
  return {
    altKey: false,
    code: 'Enter',
    ctrlKey: false,
    isComposing: false,
    key: 'Enter',
    keyCode: 13,
    metaKey: false,
    preventDefault: vi.fn(),
    shiftKey: false,
    stopPropagation: vi.fn(),
    target: document.createElement('div'),
    ...options,
  } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
  }
}

function createFixture({ text = '```ts', blockType = 'paragraph' } = {}) {
  let keydownListener: KeyListener | null = null
  const block = {
    id: 'block-1',
    type: blockType,
    content: text ? [{ type: 'text', text, styles: {} }] : [],
  }
  const editor = {
    _tiptapEditor: { view: { composing: false } },
    focus: vi.fn(),
    getTextCursorPosition: vi.fn(() => ({ block })),
    isEditable: true,
    updateBlock: vi.fn(),
  }
  const dom = document.createElement('div')
  vi.spyOn(dom, 'addEventListener').mockImplementation((type, listener) => {
    if (type === 'keydown') keydownListener = listener as KeyListener
  })
  const extension = createRichEditorCodeBlockShortcutExtension()({ editor: editor as never })
  const controller = new AbortController()
  extension.mount?.({ dom, root: document, signal: controller.signal })

  return {
    controller,
    editor,
    fire(event = keyboardEvent()) {
      if (!keydownListener) throw new Error('Code block extension did not register keydown')
      keydownListener(event)
      return event
    },
  }
}

describe('createRichEditorCodeBlockShortcutExtension', () => {
  it('converts a language fence into an empty code block on Enter', () => {
    const fixture = createFixture()

    const event = fixture.fire()

    expect(fixture.editor.updateBlock).toHaveBeenCalledWith('block-1', {
      type: 'codeBlock',
      props: { language: 'typescript' },
      content: [],
    })
    expect(event.preventDefault).toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith('editor_code_block_created', { source: 'markdown_fence' })
    fixture.controller.abort()
  })

  it('converts the current paragraph with the cross-platform code block shortcut', () => {
    const fixture = createFixture({ text: 'const answer = 42' })
    const event = keyboardEvent({ code: 'Backquote', key: '`', metaKey: true, shiftKey: true })

    fixture.fire(event)

    expect(fixture.editor.updateBlock).toHaveBeenCalledWith('block-1', {
      type: 'codeBlock',
      props: { language: 'text' },
    })
    expect(trackEvent).toHaveBeenCalledWith('editor_code_block_created', { source: 'keyboard_shortcut' })
    expect(event.preventDefault).toHaveBeenCalled()
    fixture.controller.abort()
  })

  it('selects only the active code block on Cmd+A', () => {
    const fixture = createFixture({ text: 'one\ntwo', blockType: 'codeBlock' })
    const wrapper = document.createElement('div')
    wrapper.dataset.contentType = 'codeBlock'
    const code = document.createElement('code')
    code.textContent = 'one\ntwo'
    wrapper.appendChild(document.createElement('pre')).appendChild(code)
    document.body.appendChild(wrapper)
    const cursor = document.createRange()
    cursor.setStart(code.firstChild!, 1)
    cursor.collapse(true)
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(cursor)
    const event = keyboardEvent({ code: 'KeyA', key: 'a', metaKey: true, target: document.body })

    fixture.fire(event)

    expect(document.getSelection()?.toString()).toBe('one\ntwo')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(fixture.editor.updateBlock).not.toHaveBeenCalled()
    wrapper.remove()
    fixture.controller.abort()
  })

  it('does not intercept unrelated shortcuts or Enter outside a fence', () => {
    const fixture = createFixture({ text: 'ordinary text' })
    const event = fixture.fire()

    expect(fixture.editor.updateBlock).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    fixture.controller.abort()
  })
})

describe('isCodeBlockCreationShortcut', () => {
  it('accepts the command-shift-backquote chord on both platforms', () => {
    expect(isCodeBlockCreationShortcut(keyboardEvent({
      code: 'Backquote', key: '`', metaKey: true, shiftKey: true,
    }), 'mac')).toBe(true)
    expect(isCodeBlockCreationShortcut(keyboardEvent({
      code: 'Backquote', key: '`', ctrlKey: true, shiftKey: true,
    }), 'non-mac')).toBe(true)
  })
})
