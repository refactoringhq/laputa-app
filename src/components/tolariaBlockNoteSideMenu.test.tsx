import { fireEvent, render, screen } from '@testing-library/react'
import type { DragEventHandler, PropsWithChildren, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TolariaSideMenu } from './tolariaBlockNoteSideMenu'

type MockBlock = {
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
  getBlock: ReturnType<typeof vi.fn>
  insertBlocks: ReturnType<typeof vi.fn>
  removeBlocks: ReturnType<typeof vi.fn>
  setTextCursorPosition: ReturnType<typeof vi.fn>
  settings: { tables: { headers: boolean } }
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
  TableColumnHeaderItem: ({ children }: PropsWithChildren) => (
    <div
      role="menuitemcheckbox"
      onClick={() => {
        if (!sideMenuBlock) return

        const liveBlock = requireLiveBlock(sideMenuBlock)
        mockEditor.updateBlock(sideMenuBlock, {
          content: { ...liveBlock.content, headerCols: 1 },
        })
      }}
    >
      {children}
    </div>
  ),
  TableRowHeaderItem: ({ children }: PropsWithChildren) => (
    <div
      role="menuitemcheckbox"
      onClick={() => {
        if (!sideMenuBlock) return

        const liveBlock = requireLiveBlock(sideMenuBlock)
        mockEditor.updateBlock(sideMenuBlock, {
          content: { ...liveBlock.content, headerRows: 1 },
        })
      }}
    >
      {children}
    </div>
  ),
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

describe('TolariaSideMenu', () => {
  beforeEach(() => {
    sideMenuBlock = {
      id: 'stale-block',
      type: 'paragraph',
      content: ['old text'],
    }
    mockEditor = {
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

  it('replaces BlockNote block colors with markdown-safe drag-handle items', () => {
    mockEditor.getBlock.mockReturnValue(sideMenuBlock)
    renderSideMenuWithBlock(sideMenuBlock)

    expect(screen.getByTestId('side-menu')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Drag block',
      'Add block',
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
})
