import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { focusEditorWithRetries } from './editorFocusUtils'

function createEditableElement(className = 'ProseMirror'): HTMLDivElement {
  const editable = document.createElement('div')
  editable.className = className
  editable.contentEditable = 'true'
  editable.setAttribute('contenteditable', 'true')
  editable.tabIndex = -1
  Object.defineProperty(editable, 'isContentEditable', { configurable: true, value: true })
  return editable
}

function appendEditable(className?: string): HTMLDivElement {
  const editable = createEditableElement(className)
  document.body.appendChild(editable)
  return editable
}

function mockImmediateEditableFocus(editable: HTMLElement) {
  const realFocus = HTMLElement.prototype.focus.bind(editable)
  return vi.spyOn(editable, 'focus').mockImplementation(() => realFocus())
}

function mockImmediateAnimationFrame() {
  return vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 1
  })
}

describe('editorFocusUtils extra coverage', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('uses window focus and selection fallback before logging successful focus timing', () => {
    const editable = appendEditable()
    const realFocus = HTMLElement.prototype.focus.bind(editable)
    let focusCalls = 0
    vi.spyOn(editable, 'focus').mockImplementation(() => {
      focusCalls += 1
      if (focusCalls >= 2) realFocus()
    })

    const selection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    } as unknown as Selection

    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0')
    const windowFocusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {})
    vi.spyOn(window, 'getSelection').mockReturnValue(selection)
    vi.spyOn(performance, 'now').mockReturnValue(150)
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

    focusEditorWithRetries({ focus: vi.fn() }, false, 100)

    expect(windowFocusSpy).toHaveBeenCalled()
    expect(selection.removeAllRanges).toHaveBeenCalled()
    expect(selection.addRange).toHaveBeenCalledTimes(1)
    expect(debugSpy).toHaveBeenCalledWith('[perf] createNote → focus: 50.0ms')
  })

  it('uses the fallback editable selector and treats mixed heading content as empty text', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'bn-editor'
    const editable = createEditableElement('')
    wrapper.appendChild(editable)
    document.body.appendChild(wrapper)

    mockImmediateEditableFocus(editable)
    const rAF = mockImmediateAnimationFrame()
    const setTextCursorPosition = vi.fn()

    focusEditorWithRetries({
      focus: vi.fn(),
      document: [
        {
          id: 'title',
          type: 'heading',
          content: [{ kind: 'ignored' }, { type: 'text' }],
        },
      ],
      setTextCursorPosition,
    }, true, undefined)

    expect(rAF).toHaveBeenCalled()
    expect(setTextCursorPosition).toHaveBeenCalledWith('title', 'start')
  })

  it('does not select an empty heading until BlockNote provides a usable block id', () => {
    mockImmediateEditableFocus(appendEditable())
    mockImmediateAnimationFrame()
    const setTextCursorPosition = vi.fn((blockId: string) => {
      if (typeof blockId !== 'string') {
        throw new Error("Block doesn't have id")
      }
    })

    expect(() => {
      focusEditorWithRetries({
        focus: vi.fn(),
        document: [
          {
            type: 'heading',
            content: [],
          } as never,
        ],
        setTextCursorPosition,
      }, true, undefined)
    }).not.toThrow()
    expect(setTextCursorPosition).not.toHaveBeenCalled()
  })

  it('keeps retrying title selection when BlockNote rejects a stale heading block id', () => {
    mockImmediateEditableFocus(appendEditable())
    mockImmediateAnimationFrame()
    const setTextCursorPosition = vi.fn(() => {
      throw new Error('Block with ID ff158758-8ed7-4919-a2f8-cb00c1f9c88d not found')
    })

    expect(() => {
      focusEditorWithRetries({
        focus: vi.fn(),
        document: [
          {
            id: 'ff158758-8ed7-4919-a2f8-cb00c1f9c88d',
            type: 'heading',
            content: [],
          },
        ],
        setTextCursorPosition,
      }, true, undefined)
    }).not.toThrow()
    expect(setTextCursorPosition).toHaveBeenCalledTimes(13)
  })

  it('schedules another animation frame when nothing focusable is available yet', () => {
    const rAF = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)

    focusEditorWithRetries({ focus: vi.fn() }, false, undefined)

    expect(rAF).toHaveBeenCalledTimes(1)
  })
})
