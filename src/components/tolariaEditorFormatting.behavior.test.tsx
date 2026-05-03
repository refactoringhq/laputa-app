import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const {
  blockHasTypeMock,
  editorHasBlockWithTypeMock,
  formattingToolbarStore,
  hoverGuardMock,
  positionPopoverState,
  showState,
  useBlockNoteEditorMock,
} = vi.hoisted(() => ({
  blockHasTypeMock: vi.fn(() => true),
  editorHasBlockWithTypeMock: vi.fn(() => true),
  formattingToolbarStore: { setState: vi.fn() },
  hoverGuardMock: vi.fn(),
  positionPopoverState: { lastProps: null as null | Record<string, unknown> },
  showState: { value: true },
  useBlockNoteEditorMock: vi.fn(),
}))

function MockIcon() {
  return <svg data-testid="mock-icon" />
}

vi.mock('@blocknote/react', () => ({
  FormattingToolbar: ({ children }: { children?: ReactNode }) => (
    <div data-testid="mock-formatting-toolbar">{children}</div>
  ),
  getFormattingToolbarItems: () => [
    <div key="blockTypeSelect" />,
    <div key="boldStyleButton" />,
    <div key="italicStyleButton" />,
    <div key="strikeStyleButton" />,
    <div key="createLinkButton" />,
  ],
  PositionPopover: (props: Record<string, unknown> & { children?: ReactNode }) => {
    positionPopoverState.lastProps = props
    return <div data-testid="mock-position-popover">{props.children}</div>
  },
  useBlockNoteEditor: useBlockNoteEditorMock,
  useComponentsContext: () => ({
    FormattingToolbar: {
      Button: ({
        children,
        icon,
        label,
        onClick,
      }: {
        children?: ReactNode
        icon?: ReactNode
        label: string
        onClick: () => void
      }) => (
        <button onClick={onClick} type="button">
          {icon}
          {label}
          {children}
        </button>
      ),
    },
  }),
  useEditorState: ({ editor, selector }: { editor: unknown; selector: (context: { editor: unknown }) => unknown }) => selector({ editor }),
  useExtension: () => ({ store: formattingToolbarStore }),
  useExtensionState: () => showState.value,
}))

vi.mock('@blocknote/core', () => ({
  blockHasType: blockHasTypeMock,
  defaultProps: { textAlignment: 'left' },
  editorHasBlockWithType: editorHasBlockWithTypeMock,
}))

vi.mock('@blocknote/core/extensions', () => ({
  FormattingToolbarExtension: Symbol('FormattingToolbarExtension'),
}))

vi.mock('@mantine/core', () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => <button type="button" {...props}>{children}</button>,
  CheckIcon: () => <span data-testid="mantine-check">check</span>,
  Menu: Object.assign(
    ({ children }: { children?: ReactNode }) => <div data-testid="mantine-menu">{children}</div>,
    {
      Target: ({ children }: { children?: ReactNode }) => <>{children}</>,
      Dropdown: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
      Item: ({ children, ...props }: { children?: ReactNode }) => <button type="button" {...props}>{children}</button>,
    },
  ),
}))

vi.mock('lucide-react', () => ({
  Bold: MockIcon,
  ChevronDown: MockIcon,
  Code2: MockIcon,
  Italic: MockIcon,
  Strikethrough: MockIcon,
}))

vi.mock('./tolariaEditorFormattingConfig', () => ({
  filterTolariaFormattingToolbarItems: (items: ReactNode[]) => items,
  getTolariaBlockTypeSelectItems: () => [
    { name: 'Paragraph', type: 'paragraph', props: {}, icon: MockIcon },
    { name: 'Heading 1', type: 'heading', props: { level: 1 }, icon: MockIcon },
  ],
}))

vi.mock('./blockNoteFormattingToolbarHoverGuard', () => ({
  useBlockNoteFormattingToolbarHoverGuard: hoverGuardMock,
}))

import {
  TolariaFormattingToolbar,
  TolariaFormattingToolbarController,
} from './tolariaEditorFormatting'

function createMockEditor(blockType = 'image') {
  const selectedBlock = {
    id: 'file-block',
    type: blockType,
    props: { textAlignment: 'center', level: 1 },
    content: [{ type: 'text', text: 'Selected block' }],
  }
  const domElement = document.createElement('div')
  domElement.appendChild(document.createElement('div'))
  document.body.appendChild(domElement)

  return {
    isEditable: true,
    schema: {
      styleSchema: {
        bold: { type: 'bold', propSchema: 'boolean' },
        italic: { type: 'italic', propSchema: 'boolean' },
        strike: { type: 'strike', propSchema: 'boolean' },
        code: { type: 'code', propSchema: 'boolean' },
      },
    },
    prosemirrorState: { selection: { from: 1, to: 5 } },
    domElement,
    focus: vi.fn(),
    getActiveStyles: () => ({ bold: true }),
    getSelection: () => ({ blocks: [selectedBlock] }),
    getTextCursorPosition: () => ({ block: selectedBlock }),
    toggleStyles: vi.fn(),
    transact: vi.fn((callback: () => void) => callback()),
    updateBlock: vi.fn(),
  }
}

describe('tolariaEditorFormatting behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    positionPopoverState.lastProps = null
    showState.value = true
    useBlockNoteEditorMock.mockReturnValue(createMockEditor())
  })

  it('renders toolbar controls, inserts the inline code button, and updates block types', () => {
    const editor = createMockEditor('paragraph')
    useBlockNoteEditorMock.mockReturnValue(editor)

    render(<TolariaFormattingToolbar />)

    fireEvent.click(screen.getByRole('button', { name: /bold/i }))
    fireEvent.click(screen.getByRole('button', { name: /inline code/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Heading 1' }))

    expect(editor.focus).toHaveBeenCalled()
    expect(editor.toggleStyles).toHaveBeenCalledWith({ bold: true })
    expect(editor.toggleStyles).toHaveBeenCalledWith({ code: true })
    expect(editor.transact).toHaveBeenCalledTimes(1)
    expect(editor.updateBlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-block' }),
      { type: 'heading', props: { level: 1 } },
    )
  })

  it('controls the floating toolbar placement, hover guard, and escape-key close behavior', () => {
    const editor = createMockEditor()
    const toolbarComponent = () => <div data-testid="custom-toolbar">Toolbar</div>
    useBlockNoteEditorMock.mockReturnValue(editor)

    render(
      <TolariaFormattingToolbarController
        formattingToolbar={toolbarComponent}
        floatingUIOptions={{ useFloatingOptions: { placement: 'top-start' } }}
      />,
    )

    expect(screen.getByTestId('custom-toolbar')).toBeInTheDocument()
    expect(hoverGuardMock).toHaveBeenCalledWith({
      editor,
      container: editor.domElement,
      selectedFileBlockId: 'file-block',
      isOpen: true,
    })
    expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
      position: { from: 1, to: 5 },
      useFloatingOptions: expect.objectContaining({
        open: true,
        placement: 'top-start',
      }),
    }))

    const onOpenChange = positionPopoverState.lastProps?.useFloatingOptions as {
      onOpenChange: (open: boolean, event: unknown, reason?: string) => void
    }

    onOpenChange.onOpenChange(false, undefined, 'escape-key')

    expect(formattingToolbarStore.setState).toHaveBeenCalledWith(false)
    expect(editor.focus).toHaveBeenCalledTimes(1)
  })

  it('uses block alignment when deciding the floating placement', () => {
    const editor = createMockEditor()
    editor.getTextCursorPosition = () => ({
      block: {
        id: 'paragraph-block',
        type: 'paragraph',
        props: { textAlignment: 'right' },
        content: [{ type: 'text', text: 'Paragraph' }],
      },
    })
    useBlockNoteEditorMock.mockReturnValue(editor)

    render(<TolariaFormattingToolbarController />)

    expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
      useFloatingOptions: expect.objectContaining({
        placement: 'top-end',
      }),
    }))
  })

  it('falls back to top-start and focuses the block type trigger on mouse down', () => {
    const editor = createMockEditor('paragraph')
    const focusSpy = vi.spyOn(HTMLButtonElement.prototype, 'focus').mockImplementation(() => {})

    blockHasTypeMock.mockReturnValue(false)
    useBlockNoteEditorMock.mockReturnValue(editor)

    render(<TolariaFormattingToolbarController />)
    fireEvent.mouseDown(screen.getAllByRole('button', { name: 'Paragraph' })[0] as HTMLButtonElement)

    expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
      useFloatingOptions: expect.objectContaining({
        placement: 'top-start',
      }),
    }))
    expect(focusSpy).toHaveBeenCalled()

    focusSpy.mockRestore()
  })

  it('keeps the toolbar open during close grace and clears the timeout on unmount', () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const editor = createMockEditor('paragraph')

    useBlockNoteEditorMock.mockReturnValue(editor)

    const { rerender, unmount } = render(<TolariaFormattingToolbarController />)

    showState.value = false
    rerender(<TolariaFormattingToolbarController />)

    expect(screen.getByTestId('mock-position-popover')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(50)
    })

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()

    clearTimeoutSpy.mockRestore()
    vi.useRealTimers()
  })

  it('ignores internal pointer and focus transitions before closing on external blur', () => {
    const editor = createMockEditor('paragraph')
    useBlockNoteEditorMock.mockReturnValue(editor)

    render(
      <TolariaFormattingToolbarController
        formattingToolbar={() => <button data-testid="toolbar-action" type="button">Toolbar</button>}
      />,
    )

    const toolbarWrapper = screen.getByTestId('toolbar-action').parentElement as HTMLElement

    fireEvent.pointerEnter(toolbarWrapper)
    fireEvent.pointerLeave(toolbarWrapper, { relatedTarget: screen.getByTestId('toolbar-action') })
    fireEvent.focus(toolbarWrapper)
    fireEvent.blur(toolbarWrapper, { relatedTarget: screen.getByTestId('toolbar-action') })

    expect(screen.getByTestId('toolbar-action')).toBeInTheDocument()

    fireEvent.pointerLeave(toolbarWrapper, { relatedTarget: document.body })
    fireEvent.blur(toolbarWrapper, { relatedTarget: document.body })

    expect(formattingToolbarStore.setState).toHaveBeenCalledWith(false)
  })

  it('deduplicates floating toolbar store writes during close races', () => {
    const editor = createMockEditor('paragraph')
    useBlockNoteEditorMock.mockReturnValue(editor)

    render(
      <TolariaFormattingToolbarController
        formattingToolbar={() => <button data-testid="toolbar-action" type="button">Toolbar</button>}
      />,
    )

    const toolbarWrapper = screen.getByTestId('toolbar-action').parentElement as HTMLElement
    const floatingOptions = positionPopoverState.lastProps?.useFloatingOptions as {
      onOpenChange: (open: boolean, event: unknown, reason?: string) => void
    }

    floatingOptions.onOpenChange(true, undefined)
    floatingOptions.onOpenChange(false, undefined)
    floatingOptions.onOpenChange(false, undefined)
    fireEvent.blur(toolbarWrapper, { relatedTarget: document.body })

    expect(formattingToolbarStore.setState).toHaveBeenCalledTimes(1)
    expect(formattingToolbarStore.setState).toHaveBeenCalledWith(false)
  })

  it('hides the floating toolbar while the editor is composing IME text', () => {
    vi.useFakeTimers()
    try {
      const editor = createMockEditor('paragraph')
      const editorInput = editor.domElement.firstElementChild as HTMLElement

      useBlockNoteEditorMock.mockReturnValue(editor)

      render(<TolariaFormattingToolbarController />)

      expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
        position: { from: 1, to: 5 },
        useFloatingOptions: expect.objectContaining({ open: true }),
      }))

      act(() => {
        fireEvent.compositionStart(editorInput)
      })

      expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
        position: undefined,
        useFloatingOptions: expect.objectContaining({ open: false }),
      }))

      act(() => {
        fireEvent.compositionEnd(editorInput)
      })

      expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
        position: undefined,
        useFloatingOptions: expect.objectContaining({ open: false }),
      }))

      act(() => {
        vi.advanceTimersByTime(250)
      })

      expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
        position: { from: 1, to: 5 },
        useFloatingOptions: expect.objectContaining({ open: true }),
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the floating toolbar hidden through rapid Zhuyin composition settle cycles', () => {
    vi.useFakeTimers()
    try {
      const editor = createMockEditor('paragraph')
      const editorInput = editor.domElement.firstElementChild as HTMLElement

      useBlockNoteEditorMock.mockReturnValue(editor)

      render(<TolariaFormattingToolbarController />)

      act(() => {
        fireEvent.compositionStart(editorInput)
        fireEvent.compositionEnd(editorInput)
      })

      expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
        position: undefined,
        useFloatingOptions: expect.objectContaining({ open: false }),
      }))

      act(() => {
        vi.advanceTimersByTime(120)
        fireEvent.compositionStart(editorInput)
        fireEvent.compositionEnd(editorInput)
      })

      expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
        position: undefined,
        useFloatingOptions: expect.objectContaining({ open: false }),
      }))

      act(() => {
        vi.advanceTimersByTime(249)
      })

      expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
        position: undefined,
        useFloatingOptions: expect.objectContaining({ open: false }),
      }))

      act(() => {
        vi.advanceTimersByTime(1)
      })

      expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
        position: { from: 1, to: 5 },
        useFloatingOptions: expect.objectContaining({ open: true }),
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores composition events that start outside the editor', () => {
    const editor = createMockEditor('paragraph')
    const outsideInput = document.createElement('input')
    document.body.appendChild(outsideInput)

    useBlockNoteEditorMock.mockReturnValue(editor)

    render(<TolariaFormattingToolbarController />)

    act(() => {
      fireEvent.compositionStart(outsideInput)
    })

    expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
      position: { from: 1, to: 5 },
      useFloatingOptions: expect.objectContaining({ open: true }),
    }))
  })

  it('binds composition listeners after BlockNote provides its editor element', () => {
    const editor = createMockEditor('paragraph')
    const lateEditorElement = editor.domElement
    const editorInput = lateEditorElement.firstElementChild as HTMLElement

    editor.domElement = undefined as unknown as HTMLElement
    useBlockNoteEditorMock.mockReturnValue(editor)

    const { rerender } = render(<TolariaFormattingToolbarController />)

    expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
      position: undefined,
      useFloatingOptions: expect.objectContaining({ open: false }),
    }))

    editor.domElement = lateEditorElement
    rerender(<TolariaFormattingToolbarController />)

    expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
      position: { from: 1, to: 5 },
      useFloatingOptions: expect.objectContaining({ open: true }),
    }))

    act(() => {
      fireEvent.compositionStart(editorInput)
    })

    expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
      position: undefined,
      useFloatingOptions: expect.objectContaining({ open: false }),
    }))
  })

  it('does not open the floating toolbar when the editor anchor element is unavailable', () => {
    const editor = createMockEditor()
    editor.domElement = document.createElement('div')
    useBlockNoteEditorMock.mockReturnValue(editor)

    render(<TolariaFormattingToolbarController />)

    expect(positionPopoverState.lastProps).toEqual(expect.objectContaining({
      position: undefined,
      useFloatingOptions: expect.objectContaining({
        open: false,
      }),
    }))
  })

  it('stays stable when BlockNote selection reads throw during inline action churn', () => {
    const editor = createMockEditor('paragraph')
    const selectionError = new RangeError('Index 0 out of range for <>')

    editor.getSelection = vi.fn(() => {
      throw selectionError
    })
    editor.getTextCursorPosition = vi.fn(() => {
      throw selectionError
    })
    useBlockNoteEditorMock.mockReturnValue(editor)

    expect(() => {
      render(
        <>
          <TolariaFormattingToolbar />
          <TolariaFormattingToolbarController />
        </>,
      )
    }).not.toThrow()
  })
})
