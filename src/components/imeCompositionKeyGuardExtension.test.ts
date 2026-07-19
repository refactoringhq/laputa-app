import { describe, expect, it, vi } from 'vitest'
import {
  createImeCompositionKeyGuardExtension,
  shouldStopComposingParagraphInput,
  shouldStopComposingEditorShortcutKey,
} from './imeCompositionKeyGuardExtension'

type ShortcutKeyFixture = Pick<KeyboardEvent, 'key' | 'keyCode'>
type ListenerRegistry = Map<string, EventListener>

const COMPOSING_SHORTCUT_KEYS: Array<[string, ShortcutKeyFixture]> = [
  ['Enter', { key: 'Enter', keyCode: 13 }],
  ['Space', { key: ' ', keyCode: 32 }],
]

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
    timeStamp: 120,
    ...event,
  } as InputEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopImmediatePropagation: ReturnType<typeof vi.fn>
  }
}

function dispatchRegisteredEvent(
  listeners: ListenerRegistry,
  type: string,
  event: Event,
) {
  const listener = listeners.get(type)
  if (!listener) throw new Error(`IME composition key guard did not register a ${type} listener`)
  listener(event)
}

function createFixture() {
  const listeners: ListenerRegistry = new Map()
  const view = { composing: false }
  const dom = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener)
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
      const keyboardEvent = createKeyboardEvent(event)
      dispatchRegisteredEvent(listeners, 'keydown', keyboardEvent)
      return keyboardEvent
    },
    fireCompositionEnd(event: Partial<CompositionEvent> = {}) {
      dispatchRegisteredEvent(
        listeners,
        'compositionend',
        { timeStamp: 110, ...event } as CompositionEvent,
      )
    },
    fireBeforeInput(event: Partial<InputEvent> = {}) {
      const inputEvent = createInputEvent(event)
      dispatchRegisteredEvent(listeners, 'beforeinput', inputEvent)
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

describe('shouldStopComposingEditorShortcutKey', () => {
  it.each(COMPOSING_SHORTCUT_KEYS)('matches %s while the native event is composing', (_name, keyEvent) => {
    const event = createKeyboardEvent({ ...keyEvent, isComposing: true })

    expect(shouldStopComposingEditorShortcutKey(event, { composing: false })).toBe(true)
  })

  it('matches Enter while the ProseMirror view is still composing', () => {
    const event = createKeyboardEvent({ isComposing: false })

    expect(shouldStopComposingEditorShortcutKey(event, { composing: true })).toBe(true)
  })

  it.each(COMPOSING_SHORTCUT_KEYS)('leaves normal %s available for editor input', (_name, keyEvent) => {
    const event = createKeyboardEvent({ ...keyEvent, isComposing: false })

    expect(shouldStopComposingEditorShortcutKey(event, { composing: false })).toBe(false)
  })

  it('leaves non-shortcut composition keys alone', () => {
    const event = createKeyboardEvent({ isComposing: true, key: 'a', keyCode: 65 })

    expect(shouldStopComposingEditorShortcutKey(event, { composing: false })).toBe(false)
  })
})

describe('shouldStopComposingParagraphInput', () => {
  it('matches paragraph insertion while ProseMirror is still composing', () => {
    const event = createInputEvent()

    expect(shouldStopComposingParagraphInput(event, { composing: true })).toBe(true)
  })

  it('matches paragraph insertion armed by a recent composing Enter', () => {
    const event = createInputEvent({ timeStamp: 120 })

    expect(shouldStopComposingParagraphInput(event, { composing: false }, 100)).toBe(true)
  })

  it('leaves normal or stale paragraph insertion alone', () => {
    const normalEvent = createInputEvent({ timeStamp: 700 })
    const unrelatedInput = createInputEvent({ inputType: 'insertText', timeStamp: 120 })

    expect(shouldStopComposingParagraphInput(normalEvent, { composing: false }, 100)).toBe(false)
    expect(shouldStopComposingParagraphInput(unrelatedInput, { composing: false }, 100)).toBe(false)
    expect(shouldStopComposingParagraphInput(normalEvent, { composing: false })).toBe(false)
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

  it('guards Enter while ProseMirror still reports composition', () => {
    const fixture = createFixture()
    fixture.view.composing = true
    fixture.mount()

    const event = fixture.fireKeydown({ isComposing: false })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it.each(COMPOSING_SHORTCUT_KEYS)('stops composing %s before editor shortcuts observe IME confirmation', (
    _name,
    keyEvent,
  ) => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown({
      ...keyEvent,
      isComposing: true,
    })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('blocks one paragraph insertion emitted after a composing Enter ends', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireKeydown({ isComposing: true, timeStamp: 100 })
    fixture.fireCompositionEnd()
    const guardedEvent = fixture.fireBeforeInput()
    const laterEvent = fixture.fireBeforeInput({ timeStamp: 130 })

    expect(guardedEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(guardedEvent.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(laterEvent.preventDefault).not.toHaveBeenCalled()
    expect(laterEvent.stopImmediatePropagation).not.toHaveBeenCalled()
  })

  it('does not arm paragraph suppression for compositionend without a composing Enter', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionEnd()
    const event = fixture.fireBeforeInput()

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
  })

  it('allows a deliberate normal Enter after composition ends', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireKeydown({ isComposing: true, timeStamp: 100 })
    fixture.fireCompositionEnd()
    fixture.fireKeydown({ isComposing: false, timeStamp: 115 })
    const event = fixture.fireBeforeInput()

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
  })

  it('does not intercept normal Enter outside IME composition', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown()

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
