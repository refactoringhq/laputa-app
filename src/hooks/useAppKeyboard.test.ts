import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAppKeyboard } from './useAppKeyboard'
import { resetAppCommandDispatchStateForTests } from './appCommandDispatcher'

function fireKey(
  key: string,
  mods: { altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; code?: string } = {},
) {
  return fireKeyOnTarget(window, key, mods)
}

function fireKeyOnTarget(
  target: EventTarget,
  key: string,
  mods: { altKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; code?: string } = {},
) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: mods.code,
    altKey: mods.altKey ?? false,
    metaKey: mods.metaKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    shiftKey: mods.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  })
  target.dispatchEvent(event)
  return event
}

function makeActions() {
  return {
    onQuickOpen: vi.fn(),
    onCommandPalette: vi.fn(),
    onSearch: vi.fn(),
    onCreateNote: vi.fn(),
    onSave: vi.fn(),
    onOpenSettings: vi.fn(),
    onDeleteNote: vi.fn(),
    onArchiveNote: vi.fn(),
    onToggleOrganized: vi.fn(),
    onSetViewMode: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
    onPastePlainText: vi.fn(),
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    activeTabPathRef: { current: '/vault/test.md' } as React.MutableRefObject<string | null>,
    multiSelectionCommandRef: { current: null },
  }
}

const originalUserAgent = navigator.userAgent

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
}

describe('useAppKeyboard', () => {
  afterEach(() => {
    setUserAgent(originalUserAgent)
    delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__
    resetAppCommandDispatchStateForTests()
    vi.restoreAllMocks()
  })

  it('Cmd+1 sets view mode to editor-only', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('1', { metaKey: true })
    expect(actions.onSetViewMode).toHaveBeenCalledWith('editor-only')
  })

  it('Cmd+2 sets view mode to editor-list', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('2', { metaKey: true })
    expect(actions.onSetViewMode).toHaveBeenCalledWith('editor-list')
  })

  it('Cmd+3 sets view mode to all', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('3', { metaKey: true })
    expect(actions.onSetViewMode).toHaveBeenCalledWith('all')
  })

  it('does not fire view mode when Cmd+Alt pressed', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('1', { metaKey: true, altKey: true })
    expect(actions.onSetViewMode).not.toHaveBeenCalled()
  })

  it('Cmd+P triggers quick open', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('p', { metaKey: true })
    expect(actions.onQuickOpen).toHaveBeenCalled()
  })

  it('Cmd+O triggers quick open', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('o', { metaKey: true, code: 'KeyO' })
    expect(actions.onQuickOpen).toHaveBeenCalled()
  })

  it('Cmd+N triggers create note', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('n', { metaKey: true })
    expect(actions.onCreateNote).toHaveBeenCalled()
  })

  it('Cmd+N still works in Tauri mode', () => {
    const actions = makeActions()
    ;(window as typeof window & { __TAURI__?: object }).__TAURI__ = {}
    renderHook(() => useAppKeyboard(actions))
    fireKey('n', { metaKey: true })
    expect(actions.onCreateNote).toHaveBeenCalled()
  })

  it('Cmd+\\ still works in Tauri mode', () => {
    const actions = makeActions()
    actions.onToggleRawEditor = vi.fn()
    ;(window as typeof window & { __TAURI__?: object }).__TAURI__ = {}
    renderHook(() => useAppKeyboard(actions))
    fireKey('\\', { metaKey: true })
    expect(actions.onToggleRawEditor).toHaveBeenCalled()
  })

  it('Cmd+Shift+I still works in Tauri mode', () => {
    const actions = makeActions()
    const onToggleInspector = vi.fn()
    ;(window as typeof window & { __TAURI__?: object }).__TAURI__ = {}
    renderHook(() => useAppKeyboard({ ...actions, onToggleInspector }))
    fireKey('i', { metaKey: true, shiftKey: true })
    expect(onToggleInspector).toHaveBeenCalled()
  })

  it('Cmd+Shift+L still works in Tauri mode', () => {
    const actions = makeActions()
    const onToggleAIChat = vi.fn()
    ;(window as typeof window & { __TAURI__?: object }).__TAURI__ = {}
    renderHook(() => useAppKeyboard({ ...actions, onToggleAIChat }))
    fireKey('l', { metaKey: true, shiftKey: true })
    expect(onToggleAIChat).toHaveBeenCalled()
  })

  it('Cmd+D triggers toggle favorite on active note', () => {
    const actions = makeActions()
    actions.onToggleFavorite = vi.fn()
    renderHook(() => useAppKeyboard(actions))
    fireKey('d', { metaKey: true })
    expect(actions.onToggleFavorite).toHaveBeenCalledWith('/vault/test.md')
  })

  it('Cmd+D still works in Tauri mode', () => {
    const actions = makeActions()
    actions.onToggleFavorite = vi.fn()
    ;(window as typeof window & { __TAURI__?: object }).__TAURI__ = {}
    renderHook(() => useAppKeyboard(actions))
    fireKey('d', { metaKey: true })
    expect(actions.onToggleFavorite).toHaveBeenCalledWith('/vault/test.md')
  })

  it('Cmd+E triggers toggle organized on active note, not archive', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('e', { metaKey: true })
    expect(actions.onToggleOrganized).toHaveBeenCalledWith('/vault/test.md')
    expect(actions.onArchiveNote).not.toHaveBeenCalled()
  })

  it('Cmd+E uses the current multi-selection instead of the active note', () => {
    const actions = makeActions()
    const organizeSelected = vi.fn()
    actions.multiSelectionCommandRef.current = {
      selectedPaths: ['/vault/a.md', '/vault/b.md'],
      organizeSelected,
    }

    renderHook(() => useAppKeyboard(actions))
    fireKey('e', { metaKey: true })

    expect(organizeSelected).toHaveBeenCalledTimes(1)
    expect(actions.onToggleOrganized).not.toHaveBeenCalled()
  })

  it('lets macOS Ctrl text-editing bindings pass through focused text inputs', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    const actions = makeActions()
    actions.onToggleFavorite = vi.fn()
    renderHook(() => useAppKeyboard(actions))

    withFocusedInput(() => {
      const organize = fireKey('e', { ctrlKey: true, code: 'KeyE' })
      const nextLine = fireKey('n', { ctrlKey: true, code: 'KeyN' })
      const previousLine = fireKey('p', { ctrlKey: true, code: 'KeyP' })
      const deleteForward = fireKey('d', { ctrlKey: true, code: 'KeyD' })

      expect(organize.defaultPrevented).toBe(false)
      expect(nextLine.defaultPrevented).toBe(false)
      expect(previousLine.defaultPrevented).toBe(false)
      expect(deleteForward.defaultPrevented).toBe(false)
      expect(actions.onToggleOrganized).not.toHaveBeenCalled()
      expect(actions.onCreateNote).not.toHaveBeenCalled()
      expect(actions.onQuickOpen).not.toHaveBeenCalled()
      expect(actions.onToggleFavorite).not.toHaveBeenCalled()
    })
  })

  it('lets macOS Ctrl text-editing bindings pass through focused rich editors', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    const actions = makeActions()
    actions.onToggleFavorite = vi.fn()
    renderHook(() => useAppKeyboard(actions))

    withFocusedContentEditable((editable) => {
      expect(fireKeyOnTarget(editable, 'e', { ctrlKey: true, code: 'KeyE' }).defaultPrevented).toBe(false)
      expect(fireKeyOnTarget(editable, 'd', { ctrlKey: true, code: 'KeyD' }).defaultPrevented).toBe(false)
      expect(actions.onToggleOrganized).not.toHaveBeenCalled()
      expect(actions.onToggleFavorite).not.toHaveBeenCalled()
    })
  })

  it('still runs Command shortcuts on macOS outside focused text inputs', () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    const actions = makeActions()
    actions.onToggleFavorite = vi.fn()
    renderHook(() => useAppKeyboard(actions))

    fireKey('e', { metaKey: true, code: 'KeyE' })
    fireKey('d', { metaKey: true, code: 'KeyD' })

    expect(actions.onToggleOrganized).toHaveBeenCalledWith('/vault/test.md')
    expect(actions.onToggleFavorite).toHaveBeenCalledWith('/vault/test.md')
  })

  it('Cmd+E still works when editor focus stops propagation', () => {
    const actions = makeActions()
    const onToggleOrganized = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onToggleOrganized }))
    withFocusedContentEditable((editable) => {
      editable.addEventListener('keydown', (event) => event.stopPropagation())
      fireKeyOnTarget(editable, 'e', { metaKey: true })
      expect(onToggleOrganized).toHaveBeenCalledWith('/vault/test.md')
      expect(actions.onArchiveNote).not.toHaveBeenCalled()
    })
  })

  it('Cmd+J no longer triggers any app command', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('j', { metaKey: true })
    expect(actions.onCreateNote).not.toHaveBeenCalled()
    expect(actions.onQuickOpen).not.toHaveBeenCalled()
  })

  it('Alt+4 does not trigger any view mode', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('4', { altKey: true })
    expect(actions.onSetViewMode).not.toHaveBeenCalled()
  })

  it('Cmd+K triggers command palette', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('k', { metaKey: true })
    expect(actions.onCommandPalette).toHaveBeenCalled()
  })

  it('Cmd+Shift+F triggers search', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('f', { metaKey: true, shiftKey: true })
    expect(actions.onSearch).toHaveBeenCalled()
  })

  it('Cmd+Shift+F does not trigger other shortcuts', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('f', { metaKey: true, shiftKey: true })
    expect(actions.onQuickOpen).not.toHaveBeenCalled()
    expect(actions.onCreateNote).not.toHaveBeenCalled()
  })

  it('Cmd+Shift+V triggers plain-text paste in focused text editors', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    withFocusedContentEditable((editable) => {
      const event = fireKeyOnTarget(editable, 'v', { metaKey: true, shiftKey: true, code: 'KeyV' })

      expect(event.defaultPrevented).toBe(true)
      expect(actions.onPastePlainText).toHaveBeenCalledOnce()
    })
  })

  function withFocusedInput(fn: () => void) {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    try { fn() } finally { document.body.removeChild(input) }
  }

  function withFocusedContentEditable(fn: (editable: HTMLDivElement) => void) {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.appendChild(editable)
    editable.focus()
    try { fn(editable) } finally { document.body.removeChild(editable) }
  }

  it('Cmd+Backspace does not delete note when text input is focused', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    withFocusedInput(() => {
      fireKey('Backspace', { metaKey: true })
      expect(actions.onDeleteNote).not.toHaveBeenCalled()
    })
  })

  it('Cmd+Backspace does not delete note when contenteditable is focused', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    withFocusedContentEditable((editable) => {
      fireKeyOnTarget(editable, 'Backspace', { metaKey: true })
      expect(actions.onDeleteNote).not.toHaveBeenCalled()
    })
  })

  it('Cmd+Backspace deletes note when no text input is focused', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('Backspace', { metaKey: true })
    expect(actions.onDeleteNote).toHaveBeenCalledWith('/vault/test.md')
  })

  it('Cmd+Backspace deletes the current multi-selection instead of the active note', () => {
    const actions = makeActions()
    const deleteSelected = vi.fn()
    actions.multiSelectionCommandRef.current = {
      selectedPaths: ['/vault/a.md', '/vault/b.md'],
      deleteSelected,
    }

    renderHook(() => useAppKeyboard(actions))
    fireKey('Backspace', { metaKey: true })

    expect(deleteSelected).toHaveBeenCalledTimes(1)
    expect(actions.onDeleteNote).not.toHaveBeenCalled()
  })

  it('Cmd+Left does not go back when contenteditable is focused', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    withFocusedContentEditable((editable) => {
      fireKeyOnTarget(editable, 'ArrowLeft', { metaKey: true, code: 'ArrowLeft' })
      expect(actions.onGoBack).not.toHaveBeenCalled()
    })
  })

  it('Cmd+Right does not go forward when contenteditable is focused', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    withFocusedContentEditable((editable) => {
      fireKeyOnTarget(editable, 'ArrowRight', { metaKey: true, code: 'ArrowRight' })
      expect(actions.onGoForward).not.toHaveBeenCalled()
    })
  })

  it('Cmd+Left still goes back when no text input is focused', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('ArrowLeft', { metaKey: true, code: 'ArrowLeft' })
    expect(actions.onGoBack).toHaveBeenCalled()
  })

  it('Cmd+Right still goes forward when no text input is focused', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('ArrowRight', { metaKey: true, code: 'ArrowRight' })
    expect(actions.onGoForward).toHaveBeenCalled()
  })

  it('Cmd+K still works when text input is focused', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    withFocusedInput(() => {
      fireKey('k', { metaKey: true })
      expect(actions.onCommandPalette).toHaveBeenCalled()
    })
  })

  it('Cmd+= triggers zoom in', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('=', { metaKey: true })
    expect(actions.onZoomIn).toHaveBeenCalled()
  })

  it('Cmd++ triggers zoom in', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('+', { metaKey: true })
    expect(actions.onZoomIn).toHaveBeenCalled()
  })

  it('Cmd+- triggers zoom out', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('-', { metaKey: true })
    expect(actions.onZoomOut).toHaveBeenCalled()
  })

  it('Cmd+0 triggers zoom reset', () => {
    const actions = makeActions()
    renderHook(() => useAppKeyboard(actions))
    fireKey('0', { metaKey: true })
    expect(actions.onZoomReset).toHaveBeenCalled()
  })

  it('Cmd+Shift+L triggers toggle AI chat', () => {
    const actions = makeActions()
    const onToggleAIChat = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onToggleAIChat }))
    fireKey('l', { metaKey: true, shiftKey: true })
    expect(onToggleAIChat).toHaveBeenCalled()
  })

  it('Cmd+Shift+L works when text input is focused', () => {
    const actions = makeActions()
    const onToggleAIChat = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onToggleAIChat }))
    withFocusedInput(() => {
      fireKey('l', { metaKey: true, shiftKey: true })
      expect(onToggleAIChat).toHaveBeenCalled()
    })
  })

  it('Cmd+Shift+L works when editor stops propagation', () => {
    const actions = makeActions()
    const onToggleAIChat = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onToggleAIChat }))
    withFocusedContentEditable((editable) => {
      editable.addEventListener('keydown', (event) => event.stopPropagation())
      fireKeyOnTarget(editable, 'l', { metaKey: true, shiftKey: true })
      expect(onToggleAIChat).toHaveBeenCalled()
    })
  })

  it('Cmd+Shift+L matches by physical key code when the localized key differs', () => {
    const actions = makeActions()
    const onToggleAIChat = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onToggleAIChat }))
    fireKey('¬', { code: 'KeyL', metaKey: true, shiftKey: true })
    expect(onToggleAIChat).toHaveBeenCalled()
  })

  it('Ctrl+Shift+L triggers toggle AI chat', () => {
    const actions = makeActions()
    const onToggleAIChat = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onToggleAIChat }))
    fireKey('l', { ctrlKey: true, shiftKey: true })
    expect(onToggleAIChat).toHaveBeenCalled()
  })

  it('Cmd+I does not trigger AI chat (reserved for italic)', () => {
    const actions = makeActions()
    const onToggleAIChat = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onToggleAIChat }))
    fireKey('i', { metaKey: true })
    expect(onToggleAIChat).not.toHaveBeenCalled()
  })

  it('Cmd+Shift+O triggers open in new window', () => {
    const actions = makeActions()
    const onOpenInNewWindow = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onOpenInNewWindow }))
    fireKey('o', { metaKey: true, shiftKey: true })
    expect(onOpenInNewWindow).toHaveBeenCalled()
  })

  it('Cmd+Shift+I triggers toggle inspector', () => {
    const actions = makeActions()
    const onToggleInspector = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onToggleInspector }))
    fireKey('i', { metaKey: true, shiftKey: true })
    expect(onToggleInspector).toHaveBeenCalled()
  })

  it('Cmd+Shift+I does not trigger AI chat toggle', () => {
    const actions = makeActions()
    const onToggleAIChat = vi.fn()
    const onToggleInspector = vi.fn()
    renderHook(() => useAppKeyboard({ ...actions, onToggleAIChat, onToggleInspector }))
    fireKey('i', { metaKey: true, shiftKey: true })
    expect(onToggleInspector).toHaveBeenCalled()
    expect(onToggleAIChat).not.toHaveBeenCalled()
  })
})
