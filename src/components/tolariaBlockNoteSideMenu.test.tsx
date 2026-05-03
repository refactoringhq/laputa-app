import { fireEvent, render, screen } from '@testing-library/react'
import type { DragEventHandler, PropsWithChildren, ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TolariaSideMenu } from './tolariaBlockNoteSideMenu'

type MockBlock = {
  children?: MockBlock[]
  id: string
  type: string
  content?: unknown
}

type SideMenuButtonProps = {
  draggable?: boolean
  icon?: ReactNode
  label: string
  onClick?: () => void
  onDragEnd?: DragEventHandler<HTMLButtonElement>
  onDragStart?: DragEventHandler<HTMLButtonElement>
}

type MenuItemProps = PropsWithChildren<{
  checked?: boolean
  className?: string
  onClick?: () => void
}>

type MockEditor = {
  domElement: HTMLElement
  focus: ReturnType<typeof vi.fn>
  getBlock: ReturnType<typeof vi.fn>
  insertBlocks: ReturnType<typeof vi.fn>
  removeBlocks: ReturnType<typeof vi.fn>
  setTextCursorPosition: ReturnType<typeof vi.fn>
  settings: { tables: { headers: boolean } }
  transact: ReturnType<typeof vi.fn>
  updateBlock: ReturnType<typeof vi.fn>
}

let mockEditor: MockEditor
let mockSideMenu: {
  blockDragEnd: ReturnType<typeof vi.fn>
  blockDragStart: ReturnType<typeof vi.fn>
  freezeMenu: ReturnType<typeof vi.fn>
  unfreezeMenu: ReturnType<typeof vi.fn>
}
let mockSuggestionMenu: { openSuggestionMenu: ReturnType<typeof vi.fn> }
let sideMenuBlock: MockBlock | undefined
const originalElementsFromPoint = document.elementsFromPoint

beforeAll(() => {
  if (typeof globalThis.PointerEvent !== 'undefined') return

  class TestPointerEvent extends MouseEvent {
    readonly isPrimary: boolean
    readonly pointerId: number

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.isPrimary = init.isPrimary ?? true
      this.pointerId = init.pointerId ?? 1
    }
  }

  Object.defineProperty(globalThis, 'PointerEvent', {
    configurable: true,
    value: TestPointerEvent,
  })
})

function targetBlockId(block: MockBlock | string) {
  return typeof block === 'string' ? block : block.id
}

function staleBlockError(block: MockBlock | string) {
  return new Error(`Block with ID ${targetBlockId(block)} not found`)
}

function requireLiveBlock(block: MockBlock | string) {
  const liveBlock = mockEditor.getBlock(targetBlockId(block))
  if (!liveBlock) throw staleBlockError(block)
  return liveBlock
}

vi.mock('@blocknote/core/extensions', () => ({
  SideMenuExtension: { key: 'side-menu' },
  SuggestionMenu: { key: 'suggestion-menu' },
}))

vi.mock('@blocknote/react', () => ({
  AddBlockButton: () => (
    <button
      type="button"
      onClick={() => {
        if (!sideMenuBlock) return

        const blockContent = sideMenuBlock.content
        const isBlockEmpty = Array.isArray(blockContent) && blockContent.length === 0
        if (isBlockEmpty) {
          mockEditor.setTextCursorPosition(sideMenuBlock)
          mockSuggestionMenu.openSuggestionMenu('/')
        } else {
          const insertedBlock = mockEditor.insertBlocks([{ type: 'paragraph' }], sideMenuBlock, 'after')[0]
          mockEditor.setTextCursorPosition(insertedBlock)
          mockSuggestionMenu.openSuggestionMenu('/')
        }
      }}
    >
      Add block
    </button>
  ),
  DragHandleMenu: ({ children }: PropsWithChildren) => (
    <div data-testid="drag-handle-menu">{children}</div>
  ),
  DragHandleButton: () => {
    return (
      <button
        type="button"
        draggable
        onDragStart={() => {
          if (sideMenuBlock) mockSideMenu.blockDragStart({ dataTransfer: null, clientY: 10 }, sideMenuBlock)
        }}
      >
        Drag block
      </button>
    )
  },
  RemoveBlockItem: ({ children }: PropsWithChildren) => (
    <div
      role="menuitem"
      onClick={() => {
        if (sideMenuBlock) mockEditor.removeBlocks([sideMenuBlock])
      }}
    >
      {children}
    </div>
  ),
  SideMenu: ({ children }: PropsWithChildren) => <div data-testid="side-menu">{children}</div>,
  useBlockNoteEditor: () => mockEditor,
  useComponentsContext: () => ({
    Generic: {
      Menu: {
        Item: ({ children, onClick }: MenuItemProps) => (
          <div role="menuitem" onClick={onClick}>{children}</div>
        ),
        Root: ({ children, onOpenChange }: PropsWithChildren<{ onOpenChange?: (open: boolean) => void }>) => (
          <div
            data-testid="menu-root"
            onClick={() => onOpenChange?.(true)}
          >
            {children}
          </div>
        ),
        Trigger: ({ children }: PropsWithChildren) => <div>{children}</div>,
      },
    },
    SideMenu: {
      Button: ({ draggable, label, onClick, onDragEnd, onDragStart }: SideMenuButtonProps) => (
        <button
          type="button"
          draggable={draggable}
          onClick={onClick}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
        >
          {label}
        </button>
      ),
    },
  }),
  useDictionary: () => ({
    drag_handle: {
      delete_menuitem: 'Delete',
      header_row_menuitem: 'Header row',
      header_column_menuitem: 'Header column',
      colors_menuitem: 'Colors',
    },
    side_menu: {
      add_block_label: 'Add block',
      drag_handle_label: 'Drag block',
    },
  }),
  useExtension: (extension: { key: string }) => (
    extension.key === 'suggestion-menu' ? mockSuggestionMenu : mockSideMenu
  ),
  useExtensionState: (_extension: unknown, options?: { selector?: (state: { block?: MockBlock }) => unknown }) => (
    options?.selector ? options.selector({ block: sideMenuBlock }) : { block: sideMenuBlock }
  ),
}))

function renderSideMenuWithBlock(block: MockBlock | undefined) {
  sideMenuBlock = block
  render(<TolariaSideMenu />)
}

function rect(left: number, top: number, width: number, height: number) {
  return DOMRect.fromRect({ x: left, y: top, width, height })
}

function blockElement(id: string, bounds: DOMRect) {
  const element = document.createElement('div')
  element.dataset.id = id
  element.dataset.nodeType = 'blockContainer'
  element.getBoundingClientRect = vi.fn(() => bounds)
  return element
}

function dispatchPointerEvent(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: PointerEventInit,
) {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId: 1,
    ...init,
  }))
}

function testBlock(id: string, type: string, content: unknown): MockBlock {
  return { id, type, content, children: [] }
}

function dispatchHandlePointerReorder(dragHandle: HTMLElement) {
  dispatchPointerEvent(dragHandle.parentElement!, 'pointerdown', { button: 0, clientX: 80, clientY: 90 })
  dispatchPointerEvent(document, 'pointermove', { clientX: 130, clientY: 122 })
  dispatchPointerEvent(document, 'pointerup', { clientX: 130, clientY: 122 })
}

function renderPointerReorderFixture() {
  const draggedBlock = testBlock('dragged-block', 'heading', ['Notes'])
  const targetBlock = testBlock('target-block', 'paragraph', ['Paragraph'])
  const draggedElement = blockElement(draggedBlock.id, rect(120, 80, 420, 40))
  const targetElement = blockElement(targetBlock.id, rect(120, 120, 420, 40))
  mockEditor.domElement.append(draggedElement, targetElement)
  mockEditor.getBlock.mockImplementation((id: string) => (
    id === draggedBlock.id ? draggedBlock
      : id === targetBlock.id ? targetBlock
        : undefined
  ))
  document.elementsFromPoint = vi.fn(() => [targetElement, mockEditor.domElement])

  renderSideMenuWithBlock(draggedBlock)

  return {
    draggedBlock,
    draggedElement,
    dragHandle: screen.getByRole('button', { name: 'Drag block' }),
    targetBlock,
  }
}

describe('TolariaSideMenu', () => {
  beforeEach(() => {
    const editorElement = document.createElement('div')
    editorElement.className = 'bn-editor'
    editorElement.getBoundingClientRect = vi.fn(() => rect(100, 50, 500, 400))
    document.body.appendChild(editorElement)

    sideMenuBlock = {
      id: 'stale-block',
      type: 'paragraph',
      content: ['old text'],
      children: [],
    }
    mockEditor = {
      domElement: editorElement,
      focus: vi.fn(),
      getBlock: vi.fn(() => undefined),
      insertBlocks: vi.fn((_blocks, block: MockBlock | string) => {
        requireLiveBlock(block)
        return [{ id: 'inserted-block', type: 'paragraph', content: [] }]
      }),
      removeBlocks: vi.fn((blocks: Array<MockBlock | string>) => {
        blocks.forEach(requireLiveBlock)
        return blocks
      }),
      setTextCursorPosition: vi.fn((block: MockBlock | string) => {
        requireLiveBlock(block)
      }),
      settings: { tables: { headers: true } },
      transact: vi.fn((callback: () => void) => callback()),
      updateBlock: vi.fn((block: MockBlock | string) => {
        requireLiveBlock(block)
        return block
      }),
    }
    mockSideMenu = {
      blockDragEnd: vi.fn(),
      blockDragStart: vi.fn((_event, block: MockBlock) => {
        requireLiveBlock(block)
      }),
      freezeMenu: vi.fn(),
      unfreezeMenu: vi.fn(),
    }
    mockSuggestionMenu = { openSuggestionMenu: vi.fn() }
  })

  afterEach(() => {
    document.elementsFromPoint = originalElementsFromPoint
    document.body.innerHTML = ''
  })

  it('replaces BlockNote block colors with markdown-safe drag-handle items', () => {
    mockEditor.getBlock.mockReturnValue(sideMenuBlock)
    renderSideMenuWithBlock(sideMenuBlock)

    expect(screen.getByTestId('side-menu')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Add block',
      'Drag block',
    ])

    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.queryByText('Colors')).not.toBeInTheDocument()
  })

  it('ignores add-block clicks when reload churn leaves the side menu with a stale block', () => {
    renderSideMenuWithBlock(sideMenuBlock)

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Add block' }))).not.toThrow()
    expect(mockEditor.insertBlocks).not.toHaveBeenCalled()
    expect(mockEditor.setTextCursorPosition).not.toHaveBeenCalled()
    expect(mockSuggestionMenu.openSuggestionMenu).not.toHaveBeenCalled()
  })

  it('resolves the live block before adding a block after reload churn', () => {
    const staleBlock = { id: 'same-id', type: 'paragraph', content: [] }
    const liveBlock = { id: 'same-id', type: 'paragraph', content: ['fresh text'] }
    mockEditor.getBlock.mockReturnValue(liveBlock)

    renderSideMenuWithBlock(staleBlock)
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }))

    expect(mockEditor.insertBlocks).toHaveBeenCalledWith([{ type: 'paragraph' }], liveBlock.id, 'after')
    expect(mockEditor.setTextCursorPosition).toHaveBeenCalledWith('inserted-block')
    expect(mockSuggestionMenu.openSuggestionMenu).toHaveBeenCalledWith('/')
  })

  it('ignores delete clicks when the side-menu block disappeared during a reload', () => {
    renderSideMenuWithBlock(sideMenuBlock)

    expect(() => fireEvent.click(screen.getByText('Delete'))).not.toThrow()
    expect(mockEditor.removeBlocks).not.toHaveBeenCalled()
  })

  it('resolves the live table block before toggling table headers', () => {
    const staleTable = {
      id: 'table-block',
      type: 'table',
      content: { type: 'tableContent', rows: [], headerRows: undefined },
    }
    const liveTable = {
      id: 'table-block',
      type: 'table',
      content: { type: 'tableContent', rows: [], headerRows: undefined },
    }
    mockEditor.getBlock.mockReturnValue(liveTable)

    renderSideMenuWithBlock(staleTable)
    fireEvent.click(screen.getByText('Header row'))

    expect(mockEditor.updateBlock).toHaveBeenCalledWith(liveTable.id, {
      content: { ...liveTable.content, headerRows: 1 },
    })
  })

  it('ignores stale drag starts after reload churn', () => {
    renderSideMenuWithBlock(sideMenuBlock)

    expect(() => fireEvent.dragStart(screen.getByRole('button', { name: 'Drag block' }))).not.toThrow()
    expect(mockSideMenu.blockDragStart).not.toHaveBeenCalled()
  })

  it('reorders blocks with pointer movement instead of BlockNote HTML drag data', () => {
    const { draggedBlock, dragHandle, targetBlock } = renderPointerReorderFixture()

    dispatchHandlePointerReorder(dragHandle)

    expect(mockSideMenu.blockDragStart).not.toHaveBeenCalled()
    expect(mockEditor.focus).toHaveBeenCalled()
    expect(mockEditor.transact).toHaveBeenCalled()
    expect(mockEditor.removeBlocks).toHaveBeenCalledWith([draggedBlock.id])
    expect(mockEditor.insertBlocks).toHaveBeenCalledWith([draggedBlock], targetBlock.id, 'before')
  })

  it('shows and clears pointer reorder affordances while dragging', () => {
    const { draggedElement, dragHandle } = renderPointerReorderFixture()

    dispatchPointerEvent(dragHandle.parentElement!, 'pointerdown', { button: 0, clientX: 140, clientY: 90 })
    dispatchPointerEvent(document, 'pointermove', { clientX: 180, clientY: 122 })

    const preview = screen.getByTestId('editor-block-drag-preview')
    const indicator = screen.getByTestId('editor-block-drop-indicator')
    expect(preview).toHaveStyle({
      left: '160px',
      opacity: '0.72',
      top: '112px',
    })
    expect(indicator).toHaveStyle({
      display: 'block',
      left: '120px',
      top: '119px',
      width: '420px',
    })
    expect(draggedElement).toHaveStyle({ opacity: '0.35' })

    dispatchPointerEvent(document, 'pointerup', { clientX: 180, clientY: 122 })

    expect(screen.queryByTestId('editor-block-drag-preview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('editor-block-drop-indicator')).not.toBeInTheDocument()
    expect(draggedElement.style.opacity).toBe('')
  })

  it('keeps click-to-open menu behavior when the handle does not move', () => {
    mockEditor.getBlock.mockReturnValue(sideMenuBlock)
    renderSideMenuWithBlock(sideMenuBlock)

    const dragHandle = screen.getByRole('button', { name: 'Drag block' })
    dispatchPointerEvent(dragHandle.parentElement!, 'pointerdown', { button: 0, clientX: 80, clientY: 90 })
    dispatchPointerEvent(document, 'pointerup', { clientX: 80, clientY: 90 })
    fireEvent.click(dragHandle)

    expect(mockSideMenu.freezeMenu).toHaveBeenCalled()
  })

  it('suppresses the follow-up menu click after a pointer reorder', () => {
    const { dragHandle } = renderPointerReorderFixture()

    dispatchHandlePointerReorder(dragHandle)
    fireEvent.click(dragHandle)

    expect(mockSideMenu.freezeMenu).not.toHaveBeenCalled()
  })
})
