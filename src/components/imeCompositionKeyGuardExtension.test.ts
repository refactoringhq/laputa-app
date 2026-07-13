import { describe, expect, it, vi } from 'vitest'
import {
  createImeCompositionKeyGuardExtension,
  shouldStopComposingEditorShortcutKey,
} from './imeCompositionKeyGuardExtension'

type KeyListener = (event: KeyboardEvent) => void
type ShortcutKeyFixture = Pick<KeyboardEvent, 'key' | 'keyCode'>

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

function createFixture() {
  let keydownListener: KeyListener | null = null
  const view = { composing: false }
  const dom = {
    addEventListener: vi.fn((type: string, listener: KeyListener) => {
      if (type === 'keydown') {
        keydownListener = listener
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

  it('does not intercept normal Enter outside IME composition', () => {
    const fixture = createFixture()
    fixture.mount()

    const event = fixture.fireKeydown()

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
