import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createImeCompositionKeyGuardExtension,
  shouldStopComposingEnterKey,
  shouldStopComposingStructuralKey,
} from './imeCompositionKeyGuardExtension'

type DomListener = (event: never) => void

function createKeyboardEvent(event: Partial<KeyboardEvent> = {}) {
  return {
    code: '',
    isComposing: false,
    key: 'Enter',
    keyCode: 13,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    timeStamp: 0,
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
    timeStamp: 0,
    ...event,
  } as InputEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopImmediatePropagation: ReturnType<typeof vi.fn>
  }
}

function createCompositionEvent(event: Partial<CompositionEvent> = {}) {
  return {
    data: '',
    ...event,
  } as CompositionEvent
}

function createFixture() {
  const listeners = new Map<string, DomListener>()
  let documentText = ''
  const originalHandler = vi.fn()
  const wrappedHandlers: Array<(viewArg: unknown, event: KeyboardEvent) => unknown> = []
  const dispatch = vi.fn((transaction: {
    __insertText?: { from: number; text: string; to: number }
    steps?: Array<{ toJSON?: () => unknown }>
  }) => {
    if (transaction.__insertText) {
      const { from, text, to } = transaction.__insertText
      documentText = `${documentText.slice(0, from)}${text}${documentText.slice(to)}`
      return
    }

    const step = transaction.steps?.[0]
    const json = step?.toJSON?.() as {
      from?: number
      slice?: { content?: Array<{ text?: string }> }
      to?: number
    } | undefined
    const content = json?.slice?.content
    const text = content
      ?.map((node) => node.text)
      .filter((value): value is string => typeof value === 'string')
      .join('')
    if (text) {
      const from = json?.from ?? 0
      const to = json?.to ?? from
      documentText = `${documentText.slice(0, from)}${text}${documentText.slice(to)}`
    }
  })
  const view = {
    composing: false,
    dispatch,
    someProp: vi.fn((propName: string, callback?: unknown) => {
      if (propName !== 'handleKeyDown' || typeof callback !== 'function') return undefined

      return (callback as (handler: unknown) => unknown)((viewArg: unknown, event: KeyboardEvent) => {
        originalHandler(viewArg, event)
        return false
      })
    }),
    state: {
      doc: {
        content: { size: 0 },
        textBetween: (from: number, to: number) => documentText.slice(from, to),
      },
      selection: {
        anchor: 0,
        from: 0,
        head: 0,
        to: 0,
      },
      tr: {
        insertText: (text: string, from = 0, to = from) => ({
          __insertText: { from, text, to },
          docChanged: true,
          selectionSet: true,
        }),
      },
    },
  }
  const dom = {
    addEventListener: vi.fn((type: string, listener: DomListener) => {
      listeners.set(type, listener)
    }),
  }
  const editor = {
    _tiptapEditor: { view },
    prosemirrorView: view,
  }
  const extension = createImeCompositionKeyGuardExtension()({ editor: editor as never })

  function fireEvent<T extends KeyboardEvent | InputEvent | CompositionEvent>(
    type: string,
    event: T,
  ) {
    const listener = listeners.get(type)
    if (!listener) {
      throw new Error(`IME composition key guard did not register a ${type} listener`)
    }

    listener(event as never)
    return event
  }

  return {
    dom,
    extension,
    fireBeforeInput(event: Partial<InputEvent> = {}) {
      return fireEvent('beforeinput', createInputEvent(event))
    },
    fireCompositionEnd(event: Partial<CompositionEvent> = {}) {
      return fireEvent('compositionend', createCompositionEvent(event))
    },
    fireCompositionStart(event: Partial<CompositionEvent> = {}) {
      return fireEvent('compositionstart', createCompositionEvent(event))
    },
    fireKeydown(event: Partial<KeyboardEvent> = {}) {
      return fireEvent('keydown', createKeyboardEvent(event))
    },
    fireProseMirrorKeydown(event: Partial<KeyboardEvent> = {}) {
      if (wrappedHandlers.length === 0) {
        throw new Error('IME composition key guard did not patch ProseMirror keydown handlers')
      }

      const keyboardEvent = createKeyboardEvent(event)
      const result = wrappedHandlers[0](view, keyboardEvent)
      return { event: keyboardEvent, result }
    },
    getDocumentText() {
      return documentText
    },
    setDocumentText(text: string) {
      documentText = text
    },
    mount() {
      const controller = new AbortController()
      extension.mount?.({
        dom: dom as never,
        root: document,
        signal: controller.signal,
      })
      view.someProp('handleKeyDown', (handler: unknown) => {
        wrappedHandlers.push(handler as (viewArg: unknown, event: KeyboardEvent) => unknown)
        return undefined
      })
      return controller
    },
    originalDispatch: dispatch,
    originalHandler,
    view,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

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
})

describe('shouldStopComposingStructuralKey', () => {
  it('matches composing Enter', () => {
    const event = createKeyboardEvent({ isComposing: true })

    expect(shouldStopComposingStructuralKey(event, { composing: false })).toBe(true)
  })

  it('matches Tab while the native event is composing', () => {
    const event = createKeyboardEvent({
      code: 'Tab',
      isComposing: true,
      key: 'Tab',
      keyCode: 9,
    })

    expect(shouldStopComposingStructuralKey(event, { composing: false })).toBe(true)
  })

  it('matches Shift+Tab while the native event is composing', () => {
    const event = createKeyboardEvent({
      code: 'Tab',
      isComposing: true,
      key: 'Tab',
      keyCode: 9,
      shiftKey: true,
    })

    expect(shouldStopComposingStructuralKey(event, { composing: false })).toBe(true)
  })

  it('matches Tab while the ProseMirror view is still composing', () => {
    const event = createKeyboardEvent({
      code: 'Tab',
      isComposing: false,
      key: 'Tab',
      keyCode: 9,
    })

    expect(shouldStopComposingStructuralKey(event, { composing: true })).toBe(true)
  })

  it('leaves normal Tab available for list indentation', () => {
    const event = createKeyboardEvent({
      code: 'Tab',
      isComposing: false,
      key: 'Tab',
      keyCode: 9,
    })

    expect(shouldStopComposingStructuralKey(event, { composing: false })).toBe(false)
  })

  it('leaves non-structural composition keys alone', () => {
    const event = createKeyboardEvent({ isComposing: true, key: 'a', keyCode: 65 })

    expect(shouldStopComposingStructuralKey(event, { composing: false })).toBe(false)
  })
})

describe('createImeCompositionKeyGuardExtension', () => {
  it('registers capture listeners when the editor mounts', () => {
    const fixture = createFixture()

    fixture.mount()

    for (const type of [
      'compositionstart',
      'compositionupdate',
      'compositionend',
      'compositioncancel',
      'keydown',
      'beforeinput',
    ]) {
      expect(fixture.dom.addEventListener).toHaveBeenCalledWith(
        type,
        expect.any(Function),
        expect.objectContaining({
          capture: true,
          signal: expect.any(AbortSignal),
        }),
      )
    }
  })

  it('does not emit IME debug logs by default', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fixture = createFixture()

    try {
      fixture.mount()
      fixture.fireCompositionStart()
      fixture.fireCompositionEnd()
      fixture.fireKeydown({ isComposing: false })

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[ime-debug]'))
    } finally {
      warnSpy.mockRestore()
    }
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

  it('stops ProseMirror composing Enter before list split handlers run', () => {
    const fixture = createFixture()
    fixture.view.composing = true
    fixture.mount()

    const { event, result } = fixture.fireProseMirrorKeydown({ isComposing: false })

    expect(result).toBe(true)
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(fixture.originalHandler).not.toHaveBeenCalled()
  })

  it('stops composing Tab before BlockNote list shortcuts can indent the item', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown({
      code: 'Tab',
      isComposing: true,
      key: 'Tab',
      keyCode: 9,
    })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('guards Tab while ProseMirror still reports composition', () => {
    const fixture = createFixture()
    fixture.view.composing = true
    fixture.mount()

    const event = fixture.fireKeydown({
      code: 'Tab',
      isComposing: false,
      key: 'Tab',
      keyCode: 9,
    })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('prevents the first structural key after composition end', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionStart()
    fixture.fireCompositionEnd()
    const event = fixture.fireKeydown({ isComposing: false })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not prevent later structural keys after the composition settle window', () => {
    vi.useFakeTimers()
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionStart()
    fixture.fireCompositionEnd()
    vi.advanceTimersByTime(251)
    const event = fixture.fireKeydown({ isComposing: false })

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('prevents structural beforeinput during composition', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionStart()
    const event = fixture.fireBeforeInput({ inputType: 'insertParagraph' })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('prevents structural beforeinput immediately after composition end', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionStart()
    fixture.fireCompositionEnd()
    const event = fixture.fireBeforeInput({ inputType: 'insertLineBreak' })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('prevents immediate structural beforeinput paired with a suppressed post-composition key', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionStart()
    fixture.fireCompositionEnd()
    fixture.fireKeydown({ isComposing: false, timeStamp: 100 })
    const event = fixture.fireBeforeInput({ inputType: 'insertParagraph', timeStamp: 150 })

    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not prevent composition text beforeinput', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionStart()
    const event = fixture.fireBeforeInput({ inputType: 'insertCompositionText', isComposing: true })

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not prevent committed composition text beforeinput', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.fireCompositionStart()
    fixture.fireCompositionEnd()
    const event = fixture.fireBeforeInput({ inputType: 'insertFromComposition' })

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('replaces recorded composition text when committed text arrives', () => {
    const fixture = createFixture()
    fixture.mount()

    fixture.view.dispatch({
      docChanged: true,
      getMeta: (key: unknown) => key === 'composition' ? 1 : undefined,
      selection: {
        anchor: 0,
        from: 0,
        head: 1,
        to: 1,
      },
      steps: [
        {
          toJSON: () => ({
            slice: {
              content: [{ text: 'a' }],
            },
          }),
        },
      ],
    })

    const event = fixture.fireBeforeInput({
      data: '啊',
      inputType: 'insertFromComposition',
      isComposing: true,
    })

    expect(fixture.getDocumentText()).toBe('啊')
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('uses the live document text for the recorded composition range', () => {
    const fixture = createFixture()
    fixture.setDocumentText('a')
    fixture.mount()

    fixture.view.dispatch({
      docChanged: true,
      getMeta: (key: unknown) => key === 'composition' ? 1 : undefined,
      selection: {
        anchor: 0,
        from: 0,
        head: 3,
        to: 3,
      },
      steps: [
        {
          toJSON: () => ({
            from: 1,
            slice: {
              content: [{ text: "'a" }],
            },
            to: 1,
          }),
        },
      ],
    })

    expect(fixture.getDocumentText()).toBe("a'a")

    const event = fixture.fireBeforeInput({
      data: '啊啊',
      inputType: 'insertFromComposition',
      isComposing: true,
    })

    expect(fixture.getDocumentText()).toBe('啊啊')
    expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not intercept normal Enter outside IME composition', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown()

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not intercept normal Tab outside IME composition', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown({
      code: 'Tab',
      isComposing: false,
      key: 'Tab',
      keyCode: 9,
    })

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
