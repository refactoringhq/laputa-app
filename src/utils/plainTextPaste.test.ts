import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activatePlainTextPasteTarget,
  insertPlainTextFromClipboardText,
  registerPlainTextPasteTarget,
} from './plainTextPaste'

const { trackEvent } = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}))

vi.mock('../lib/telemetry', () => ({
  trackEvent,
}))

describe('plainTextPaste', () => {
  afterEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('replaces the selected text in a focused textarea', () => {
    const input = document.createElement('textarea')
    input.value = 'Alpha Beta'
    document.body.appendChild(input)
    input.focus()
    input.setSelectionRange(6, 10)

    expect(insertPlainTextFromClipboardText('Plain\nText')).toBe(true)

    expect(input.value).toBe('Alpha Plain\nText')
    expect(input.selectionStart).toBe(16)
    expect(trackEvent).toHaveBeenCalledWith('plain_text_paste_used', {
      surface: 'focused_input',
    })
  })

  it('keeps command palette focus from swallowing the paste target', () => {
    const palette = document.createElement('div')
    palette.setAttribute('data-command-palette', 'true')
    const input = document.createElement('input')
    palette.appendChild(input)
    document.body.appendChild(palette)

    const target = {
      contains: () => false,
      insert: vi.fn(() => true),
      isConnected: () => true,
      surface: 'raw_editor',
    }

    const unregister = registerPlainTextPasteTarget(target)
    activatePlainTextPasteTarget(target)
    input.focus()

    expect(insertPlainTextFromClipboardText('Plain')).toBe(true)
    expect(target.insert).toHaveBeenCalledWith('Plain')
    expect(input.value).toBe('')
    expect(trackEvent).toHaveBeenCalledWith('plain_text_paste_used', {
      surface: 'raw_editor',
    })

    unregister()
  })

  it('uses the latest registered editor target when focus is outside text controls', () => {
    const target = {
      contains: () => false,
      insert: vi.fn(() => true),
      isConnected: () => true,
      surface: 'rich_editor',
    }

    const unregister = registerPlainTextPasteTarget(target)
    document.body.focus()

    expect(insertPlainTextFromClipboardText('Plain')).toBe(true)
    expect(target.insert).toHaveBeenCalledWith('Plain')
    expect(trackEvent).toHaveBeenCalledWith('plain_text_paste_used', {
      surface: 'rich_editor',
    })

    unregister()
  })

  it('does not treat non-text inputs as editable paste surfaces', () => {
    const input = document.createElement('input')
    input.type = 'checkbox'
    document.body.appendChild(input)
    input.focus()

    expect(insertPlainTextFromClipboardText('Plain')).toBe(false)
    expect(trackEvent).not.toHaveBeenCalled()
  })
})
