import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendBlockOuters,
  cleanupSideMenuTest,
  collapsedSectionStyleText,
  dispatchHandlePointerReorder,
  dispatchPointerEvent,
  expectCollapsedSectionStyleNotToTarget,
  expectCollapsedSectionStyleToTarget,
  headingBlock,
  installPointerEventSupport,
  listItemBlock,
  mockEditor,
  mockSideMenu,
  mockSuggestionMenu,
  placeEditorInScrollArea,
  renderPointerReorderFixture,
  renderSideMenuAndCollapseControllerWithBlock,
  renderSideMenuWithBlock,
  requireParentElement,
  rootSideMenuButtonText,
  setupSideMenuTest,
  sideMenuBlock,
  staleBlockError,
  testBlock,
  turnIntoButtonLabels,
} from '../../tests/support/tolariaBlockNoteSideMenuTestUtils'

beforeAll(installPointerEventSupport)

describe('TolariaSideMenu', () => {
  beforeEach(setupSideMenuTest)
  afterEach(cleanupSideMenuTest)

  it('replaces BlockNote block colors with markdown-safe drag-handle items', () => {
    mockEditor.getBlock.mockReturnValue(sideMenuBlock)
    renderSideMenuWithBlock(sideMenuBlock)

    expect(screen.getByTestId('side-menu')).toBeInTheDocument()
    expect(rootSideMenuButtonText()).toEqual([
      'Drag block',
      'Delete',
      'Turn into...',
      'Add block',
    ])

    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn into...' })).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.getByTestId('menu-sub-dropdown')).toHaveClass('tolaria-turn-into-menu-dropdown')
    for (const label of turnIntoButtonLabels) {
      expect(screen.getByTestId(`menu-item-icon-${label}`)).toBeInTheDocument()
    }
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

  it('keeps editor scroll stable when opening the add-block slash menu', async () => {
    const scrollArea = placeEditorInScrollArea(480)
    const liveBlock = { id: 'tail-block', type: 'paragraph', content: ['Tail text'] }
    mockEditor.getBlock.mockReturnValue(liveBlock)
    mockEditor.insertBlocks.mockImplementation(() => {
      scrollArea.scrollTop = 120
      return [{ id: 'inserted-block', type: 'paragraph', content: [] }]
    })
    mockEditor.setTextCursorPosition.mockImplementation(() => {
      scrollArea.scrollTop = 180
    })
    mockSuggestionMenu.openSuggestionMenu.mockImplementation(() => {
      queueMicrotask(() => {
        scrollArea.scrollTop = 240
      })
    })

    renderSideMenuWithBlock(liveBlock)
    const addBlockButton = screen.getByRole('button', { name: 'Add block' })
    fireEvent.click(addBlockButton)
    await Promise.resolve()

    expect(scrollArea.scrollTop).toBe(480)
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

  it('turns a live side-menu block into another markdown-safe block type', () => {
    const liveBlock = {
      id: 'paragraph-block',
      type: 'paragraph',
      content: ['Existing text'],
      props: {},
      children: [],
    }
    mockEditor.getBlock.mockReturnValue(liveBlock)

    renderSideMenuWithBlock(liveBlock)
    fireEvent.click(screen.getByRole('button', { name: 'Heading 2' }))

    expect(mockEditor.focus).toHaveBeenCalledOnce()
    expect(mockEditor.updateBlock).toHaveBeenCalledWith(liveBlock.id, {
      type: 'heading',
      props: { level: 2 },
    })
  })

  it('ignores turn-into clicks when reload churn leaves a stale side-menu block', () => {
    renderSideMenuWithBlock(sideMenuBlock)

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Heading 2' }))).not.toThrow()
    expect(mockEditor.updateBlock).not.toHaveBeenCalled()
  })

  it('hides table header actions when the live block lookup throws after reload churn', () => {
    const staleTable = {
      id: 'table-block',
      type: 'table',
      content: { type: 'tableContent', rows: [], headerRows: undefined },
    }
    mockEditor.getBlock.mockImplementation(() => {
      throw staleBlockError(staleTable)
    })

    expect(() => renderSideMenuWithBlock(staleTable)).not.toThrow()
    expect(screen.queryByText('Header row')).not.toBeInTheDocument()
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

  it('ignores pointer reorders when a target block lookup throws after reload churn', () => {
    const { draggedBlock, dragHandle, targetBlock } = renderPointerReorderFixture()
    mockEditor.getBlock.mockImplementation((id: string) => {
      if (id === targetBlock.id) throw staleBlockError(id)
      return id === draggedBlock.id ? draggedBlock : undefined
    })

    expect(() => dispatchHandlePointerReorder(dragHandle)).not.toThrow()
    expect(mockEditor.removeBlocks).not.toHaveBeenCalled()
    expect(mockEditor.insertBlocks).not.toHaveBeenCalled()
  })

  it('ignores pointer reorders when the dragged block disappears during the final drop mutation', () => {
    const { draggedBlock, dragHandle } = renderPointerReorderFixture()
    const missingBlockError = staleBlockError(draggedBlock)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockEditor.removeBlocks.mockImplementation(() => {
      throw missingBlockError
    })

    expect(() => dispatchHandlePointerReorder(dragHandle)).not.toThrow()

    expect(mockEditor.removeBlocks).toHaveBeenCalledWith([draggedBlock.id])
    expect(mockEditor.insertBlocks).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('[editor] Ignored stale block side-menu action:', missingBlockError)
    warn.mockRestore()
  })

  it('shows and clears pointer reorder affordances while dragging', () => {
    const { draggedElement, dragHandle } = renderPointerReorderFixture()

    dispatchPointerEvent(requireParentElement(dragHandle), 'pointerdown', { button: 0, clientX: 140, clientY: 90 })
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
    dispatchPointerEvent(requireParentElement(dragHandle), 'pointerdown', { button: 0, clientX: 80, clientY: 90 })
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

  it('renders drag handle before heading collapse toggle for headings', () => {
    const heading = headingBlock('heading-block', 2)
    mockEditor.document = [heading]
    mockEditor.getBlock.mockReturnValue(heading)

    renderSideMenuWithBlock(heading)

    expect(rootSideMenuButtonText()).toEqual([
      'Drag block',
      'Delete',
      'Turn into...',
      'Collapse section',
    ])
  })

  it('localizes heading collapse and expand labels', () => {
    const heading = headingBlock('heading-block', 2)
    mockEditor.document = [heading]
    appendBlockOuters([heading])
    mockEditor.getBlock.mockReturnValue(heading)

    renderSideMenuAndCollapseControllerWithBlock(heading, { locale: 'it-IT' })

    fireEvent.click(screen.getByRole('button', { name: 'Comprimi sezione' }))

    expect(screen.getByRole('button', { name: 'Espandi sezione' })).toBeInTheDocument()
  })

  it('only renders the list item collapse toggle when a list item has children', () => {
    const leafListItem = listItemBlock('leaf-list-item')
    mockEditor.document = [leafListItem]
    mockEditor.getBlock.mockReturnValue(leafListItem)

    renderSideMenuWithBlock(leafListItem)

    expect(screen.getByRole('button', { name: 'Add block' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse item' })).not.toBeInTheDocument()
  })

  it('renders drag handle before list item collapse toggle for list items with children', () => {
    const parentListItem = listItemBlock('parent-list-item', [listItemBlock('child-list-item')])
    mockEditor.document = [parentListItem]
    mockEditor.getBlock.mockReturnValue(parentListItem)

    renderSideMenuWithBlock(parentListItem)

    expect(rootSideMenuButtonText()).toEqual([
      'Drag block',
      'Delete',
      'Turn into...',
      'Collapse item',
    ])
  })

  it('localizes list item collapse and expand labels', () => {
    const childListItem = listItemBlock('child-list-item')
    const parentListItem = listItemBlock('parent-list-item', [childListItem])
    mockEditor.document = [parentListItem]
    appendBlockOuters([parentListItem])
    mockEditor.getBlock.mockImplementation((id: string) => (
      [parentListItem, childListItem].find((block) => block.id === id)
    ))

    renderSideMenuAndCollapseControllerWithBlock(parentListItem, { locale: 'it-IT' })

    fireEvent.click(screen.getByRole('button', { name: 'Comprimi elemento' }))

    expect(screen.getByRole('button', { name: 'Espandi elemento' })).toBeInTheDocument()
  })

  it('does not subscribe collapsed-heading rendering until something is collapsed', () => {
    const heading = headingBlock('heading', 2)
    const paragraph = testBlock('paragraph', 'paragraph', ['Text'])
    const blocks = [heading, paragraph]
    mockEditor.document = blocks
    appendBlockOuters(blocks)
    mockEditor.getBlock.mockImplementation((id: string) => blocks.find((block) => block.id === id))

    renderSideMenuAndCollapseControllerWithBlock(heading)

    expect(mockEditor.onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse section' }))

    expect(mockEditor.onChange).toHaveBeenCalledTimes(1)
  })

  it('removes collapsed-heading edit subscriptions after the final section is expanded', () => {
    const unsubscribeEditorChange = vi.fn()
    const heading = headingBlock('heading', 2)
    const paragraph = testBlock('paragraph', 'paragraph', ['Text'])
    const blocks = [heading, paragraph]
    mockEditor.document = blocks
    appendBlockOuters(blocks)
    mockEditor.getBlock.mockImplementation((id: string) => blocks.find((block) => block.id === id))
    mockEditor.onChange.mockReturnValue(unsubscribeEditorChange)

    renderSideMenuAndCollapseControllerWithBlock(heading)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse section' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand section' }))

    expect(unsubscribeEditorChange).toHaveBeenCalledTimes(1)
    expect(collapsedSectionStyleText()).toBe('')
  })

  it('hides a collapsed heading section until the next same-level heading', () => {
    const blocks = [
      headingBlock('heading', 2),
      testBlock('paragraph', 'paragraph', ['Text']),
      headingBlock('child-heading', 3),
      testBlock('child-paragraph', 'paragraph', ['More text']),
      headingBlock('next-heading', 2),
      testBlock('after-next-heading', 'paragraph', ['Visible text']),
    ]
    mockEditor.document = blocks
    appendBlockOuters(blocks)
    mockEditor.getBlock.mockImplementation((id: string) => blocks.find((block) => block.id === id))

    renderSideMenuAndCollapseControllerWithBlock(blocks[0])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse section' }))

    expectCollapsedSectionStyleToTarget('heading')
    expectCollapsedSectionStyleToTarget('paragraph')
    expectCollapsedSectionStyleToTarget('child-heading')
    expectCollapsedSectionStyleToTarget('child-paragraph')
    expectCollapsedSectionStyleNotToTarget('next-heading')
    expectCollapsedSectionStyleNotToTarget('after-next-heading')
    expect(collapsedSectionStyleText()).toContain('display: none !important;')
    expect(collapsedSectionStyleText()).toContain('::after')
    expect(screen.getByRole('button', { name: 'Expand section' })).toBeInTheDocument()
  })

  it('collapses through a divider until the next same-level heading', () => {
    const blocks = [
      headingBlock('heading', 2),
      testBlock('paragraph', 'paragraph', ['Text']),
      testBlock('divider', 'divider', []),
      testBlock('after-divider', 'paragraph', ['More text']),
      headingBlock('next-heading', 2),
      testBlock('after-next-heading', 'paragraph', ['Visible text']),
    ]
    mockEditor.document = blocks
    appendBlockOuters(blocks)
    mockEditor.getBlock.mockImplementation((id: string) => blocks.find((block) => block.id === id))

    renderSideMenuAndCollapseControllerWithBlock(blocks[0])
    fireEvent.click(screen.getByRole('button', { name: 'Collapse section' }))

    expectCollapsedSectionStyleToTarget('paragraph')
    expectCollapsedSectionStyleToTarget('divider')
    expectCollapsedSectionStyleToTarget('after-divider')
    expectCollapsedSectionStyleNotToTarget('next-heading')
    expectCollapsedSectionStyleNotToTarget('after-next-heading')
  })

  it('collapses only the child subtree for list items with children', () => {
    const grandchild = listItemBlock('grandchild-list-item')
    const child = listItemBlock('child-list-item', [grandchild])
    const parent = listItemBlock('parent-list-item', [child])
    const sibling = listItemBlock('sibling-list-item')
    const blocks = [parent, sibling]
    mockEditor.document = blocks
    appendBlockOuters(blocks)
    mockEditor.getBlock.mockImplementation((id: string) => (
      [parent, child, grandchild, sibling].find((block) => block.id === id)
    ))

    renderSideMenuAndCollapseControllerWithBlock(parent)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse item' }))

    expectCollapsedSectionStyleToTarget('parent-list-item')
    expectCollapsedSectionStyleToTarget('child-list-item')
    expectCollapsedSectionStyleToTarget('grandchild-list-item')
    expectCollapsedSectionStyleNotToTarget('sibling-list-item')
    expect(screen.getByRole('button', { name: 'Expand item' })).toBeInTheDocument()
  })
})
