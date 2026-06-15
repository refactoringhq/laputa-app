import { describe, expect, it, vi } from 'vitest'
import {
  createImeCompositionKeyGuardExtension,
  shouldStopComposingParagraphInput,
  shouldStopComposingEnterKey,
} from './imeCompositionKeyGuardExtension'

type KeyListener = (event: KeyboardEvent) => void

function createKeyboardEvent(event: Partial<KeyboardEvent> = {}) {
  return {
    code: '',
    isComposing: false,
    key: 'Enter',
    keyCode: 13,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...event,
  } as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopImmediatePropagation: ReturnType<typeof vi.fn>
  }
}

function createInputEvent(event: Partial<InputEvent> = {}) {
  return {
    inputType: 'insertParagraph',
    isComposing: false,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    timeStamp: 100,
    ...event,
  } as InputEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopImmediatePropagation: ReturnType<typeof vi.fn>
  }
}

function createFixture() {
  let keydownListener: KeyListener | null = null
  let compositionEndListener: EventListener | null = null
  let beforeInputListener: EventListener | null = null
  const view = { composing: false }
  const dom = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'keydown') {
        keydownListener = listener as KeyListener
      }
      if (type === 'compositionend') {
        compositionEndListener = listener
      }
      if (type === 'beforeinput') {
        beforeInputListener = listener
      }
    }),
  }
  const editor = {
    _tiptapEditor: { view },
    prosemirrorView: view,
  }
  const extension = createImeCompositionKeyGuardExtension()({ editor: editor as never })

  return {
    dom,
    extension,
    fireKeydown(event: Partial<KeyboardEvent> = {}) {
      if (!keydownListener) {
        throw new Error('IME composition key guard did not register a keydown listener')
      }

      const keyboardEvent = createKeyboardEvent(event)
      keydownListener(keyboardEvent)
      return keyboardEvent
    },
    fireCompositionEnd(event: Partial<CompositionEvent> = {}) {
      if (!compositionEndListener) {
        throw new Error('IME composition key guard did not register a compositionend listener')
      }

      compositionEndListener({ timeStamp: 100, ...event } as CompositionEvent)
    },
    fireBeforeInput(event: Partial<InputEvent> = {}) {
      if (!beforeInputListener) {
        throw new Error('IME composition key guard did not register a beforeinput listener')
      }

      const inputEvent = createInputEvent(event)
      beforeInputListener(inputEvent)
      return inputEvent
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
    view,
  }
}

describe('shouldStopComposingEnterKey', () => {
  it('matches Enter while the native event is composing', () => {
    const event = createKeyboardEvent({ isComposing: true })

    expect(shouldStopComposingEnterKey(event, { composing: false })).toBe(true)
  })

  it('matches Enter while the ProseMirror view is still composing', () => {
    const event = createKeyboardEvent({ isComposing: false })

    expect(shouldStopComposingEnterKey(event, { composing: true })).toBe(true)
  })

  it('leaves normal Enter available for list editing', () => {
    const event = createKeyboardEvent({ isComposing: false })

    expect(shouldStopComposingEnterKey(event, { composing: false })).toBe(false)
  })

  it('leaves non-Enter composition keys alone', () => {
    const event = createKeyboardEvent({ isComposing: true, key: 'a', keyCode: 65 })

    expect(shouldStopComposingEnterKey(event, { composing: false })).toBe(false)
  })

  it('matches paragraph insertion while ProseMirror is still composing', () => {
    const event = createInputEvent({ isComposing: false })

    expect(shouldStopComposingParagraphInput(event, { composing: true })).toBe(true)
  })

  it('matches paragraph insertion shortly after composition ends', () => {
    const event = createInputEvent({ timeStamp: 120 })

    expect(shouldStopComposingParagraphInput(event, { composing: false }, 100)).toBe(true)
  })

  it('leaves normal paragraph insertion outside composition alone', () => {
    const event = createInputEvent({ timeStamp: 700 })

    expect(shouldStopComposingParagraphInput(event, { composing: false }, 100)).toBe(false)
  })
})

describe('createImeCompositionKeyGuardExtension', () => {
  it('registers a capture keydown listener when the editor mounts', () => {
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

  it('blocks paragraph insertion shortly after composition ends', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionEnd({ timeStamp: 100 })
    const event = fixture.fireBeforeInput({ timeStamp: 120 })

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
  })

  it('only blocks one paragraph insertion after composition ends', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionEnd({ timeStamp: 100 })
    fixture.fireBeforeInput({ timeStamp: 120 })
    const event = fixture.fireBeforeInput({ timeStamp: 130 })

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
  })

  it('stops composing Enter before BlockNote list shortcuts can split the item', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown({ isComposing: true })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('guards Enter while ProseMirror still reports composition', () => {
    const fixture = createFixture()
    fixture.view.composing = true
    fixture.mount()

    const event = fixture.fireKeydown({ isComposing: false })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not intercept normal Enter outside IME composition', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown()

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
