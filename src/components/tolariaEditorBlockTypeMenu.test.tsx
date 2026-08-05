import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

const {
  formattingToolbarStore,
  menuState,
  showState,
  useBlockNoteEditorMock,
} = vi.hoisted(() => ({
  formattingToolbarStore: { setState: vi.fn() },
  menuState: { lastProps: null as null | Record<string, unknown> },
  showState: { value: true },
  useBlockNoteEditorMock: vi.fn(),
}))

function MockIcon() {
  return <svg data-testid="mock-icon" />
}

vi.mock('@blocknote/react', () => ({
  FormattingToolbar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  getFormattingToolbarItems: () => [<div key="blockTypeSelect" />],
  PositionPopover: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  useBlockNoteEditor: useBlockNoteEditorMock,
  useComponentsContext: () => ({
    FormattingToolbar: {
      Button: () => null,
    },
  }),
  useDictionary: () => ({}),
  useEditorState: ({ editor, selector }: {
    editor: unknown
    selector: (context: { editor: unknown }) => unknown
  }) => selector({ editor }),
  useExtension: () => ({ store: formattingToolbarStore }),
  useExtensionState: () => showState.value,
}))

vi.mock('@blocknote/core', () => ({
  blockHasType: () => true,
  createExtension: (factory: unknown) => factory,
  defaultProps: { textAlignment: 'left' },
  editorHasBlockWithType: () => true,
}))

vi.mock('@blocknote/core/extensions', () => ({
  FormattingToolbarExtension: Symbol('FormattingToolbarExtension'),
}))

vi.mock('@mantine/core', () => ({
  Button: ({ children, leftSection, rightSection, ...props }: {
    children?: ReactNode
    leftSection?: ReactNode
    rightSection?: ReactNode
  }) => <button type="button" {...props}>{leftSection}{children}{rightSection}</button>,
  CheckIcon: MockIcon,
  Menu: Object.assign(
    ({ children, ...props }: { children?: ReactNode }) => {
      menuState.lastProps = props
      return <div data-testid="block-type-menu">{children}</div>
    },
    {
      Target: ({ children }: { children?: ReactNode }) => <>{children}</>,
      Dropdown: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
      Item: ({ children, leftSection, rightSection, ...props }: {
        children?: ReactNode
        leftSection?: ReactNode
        rightSection?: ReactNode
      }) => (
        <button type="button" {...props}>{leftSection}{children}{rightSection}</button>
      ),
    },
  ),
}))

vi.mock('@phosphor-icons/react', () => ({
  ArrowSquareOut: MockIcon,
  CaretDown: MockIcon,
  Code: MockIcon,
  Highlighter: MockIcon,
  TextB: MockIcon,
  TextItalic: MockIcon,
  TextStrikethrough: MockIcon,
}))

vi.mock('./tolariaEditorFormattingConfig', () => ({
  filterTolariaFormattingToolbarItems: (items: ReactNode[]) => items,
  getTolariaBlockTypeSelectItems: () => [
    { key: 'paragraph', labelKey: 'paragraph', name: 'Paragraph', type: 'paragraph', props: {}, icon: MockIcon },
    { key: 'heading-1', labelKey: 'heading1', name: 'Heading 1', type: 'heading', props: { level: 1 }, icon: MockIcon },
  ],
}))

vi.mock('./blockNoteFormattingToolbarHoverGuard', () => ({
  useBlockNoteFormattingToolbarHoverGuard: vi.fn(),
}))

vi.mock('./useEditorComposing', () => ({
  useEditorComposing: () => false,
}))

import { TolariaFormattingToolbarController } from './tolariaEditorFormatting'

function createEditor() {
  const block = {
    id: 'paragraph-block',
    type: 'paragraph',
    props: { textAlignment: 'left' },
    content: [{ type: 'text', text: 'Selected block' }],
  }
  const domElement = document.createElement('div')
  const editorInput = document.createElement('div')
  domElement.appendChild(editorInput)
  document.body.appendChild(domElement)

  return {
    block,
    editorInput,
    editor: {
      domElement,
      focus: vi.fn(),
      getActiveStyles: () => ({}),
      getBlock: vi.fn(() => block),
      getSelection: () => ({ blocks: [block] }),
      getTextCursorPosition: () => ({ block }),
      isEditable: true,
      prosemirrorState: { selection: { from: 1, to: 4 } },
      schema: { styleSchema: {} },
      transact: vi.fn((callback: () => void) => callback()),
      updateBlock: vi.fn(),
    },
  }
}

describe('Tolaria block type menu interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    menuState.lastProps = null
    showState.value = true
  })

  it('pins the toolbar while open and closes on editor interaction', () => {
    const { editor, editorInput } = createEditor()
    useBlockNoteEditorMock.mockReturnValue(editor)

    render(<TolariaFormattingToolbarController />)

    expect(screen.getByTestId('block-type-menu')).toBeInTheDocument()
    expect(menuState.lastProps?.opened).toBe(false)

    act(() => {
      const onChange = menuState.lastProps?.onChange as ((opened: boolean) => void) | undefined
      onChange?.(true)
    })

    expect(menuState.lastProps?.opened).toBe(true)

    showState.value = false
    fireEvent.pointerDown(editorInput)

    expect(screen.queryByTestId('block-type-menu')).not.toBeInTheDocument()
    expect(formattingToolbarStore.setState).toHaveBeenCalledWith(false)
  })
})
