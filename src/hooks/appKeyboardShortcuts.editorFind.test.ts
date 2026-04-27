import { describe, expect, it, vi } from 'vitest'
import { handleAppKeyboardEvent, type KeyboardActions } from './appKeyboardShortcuts'

function makeActions(): KeyboardActions {
  return {
    activeTabPathRef: { current: '/vault/a.md' },
    multiSelectionCommandRef: { current: null },
    onArchiveNote: vi.fn(),
    onCommandPalette: vi.fn(),
    onCreateNote: vi.fn(),
    onDeleteNote: vi.fn(),
    onFindInNote: vi.fn(),
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onOpenInNewWindow: vi.fn(),
    onOpenSettings: vi.fn(),
    onQuickOpen: vi.fn(),
    onReplaceInNote: vi.fn(),
    onSave: vi.fn(),
    onSearch: vi.fn(),
    onSetViewMode: vi.fn(),
    onToggleFavorite: vi.fn(),
    onToggleInspector: vi.fn(),
    onToggleOrganized: vi.fn(),
    onToggleRawEditor: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomReset: vi.fn(),
  }
}

function commandF(): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: 'KeyF',
    key: 'f',
    metaKey: true,
  })
}

function withFocusedElement(element: HTMLElement, test: () => void): void {
  document.body.appendChild(element)
  element.focus()
  try {
    test()
  } finally {
    element.remove()
  }
}

describe('editor find shortcut routing', () => {
  it('runs Cmd+F when focus is inside the editor scope', () => {
    const actions = makeActions()
    const scope = document.createElement('div')
    scope.setAttribute('data-editor-find-scope', 'true')
    const editor = document.createElement('div')
    editor.tabIndex = 0
    scope.appendChild(editor)

    withFocusedElement(scope, () => {
      editor.focus()
      const event = commandF()
      handleAppKeyboardEvent(actions, event)

      expect(event.defaultPrevented).toBe(true)
      expect(actions.onFindInNote).toHaveBeenCalledOnce()
    })
  })

  it('yields Cmd+F outside the editor scope so note-list search can handle it', () => {
    const actions = makeActions()
    const noteList = document.createElement('div')
    noteList.tabIndex = 0

    withFocusedElement(noteList, () => {
      const event = commandF()
      handleAppKeyboardEvent(actions, event)

      expect(event.defaultPrevented).toBe(false)
      expect(actions.onFindInNote).not.toHaveBeenCalled()
    })
  })
})
