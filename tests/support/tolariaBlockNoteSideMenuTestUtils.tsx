import { cleanup, render, screen } from '@testing-library/react'
import type {
  DragEventHandler,
  MouseEvent as ReactMouseEvent,
  PropsWithChildren,
  ReactNode,
} from 'react'
import { expect, vi } from 'vitest'
import {
  TolariaCollapsedHeadingsController,
  TolariaSideMenu,
} from '@/components/tolariaBlockNoteSideMenu'

export type MockBlock = {
  children?: MockBlock[]
  id: string
  props?: Record<string, unknown>
  type: string
  content?: unknown
}

export type SideMenuButtonProps = {
  draggable?: boolean
  icon?: ReactNode
  label: string
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onDragEnd?: DragEventHandler<HTMLButtonElement>
  onDragStart?: DragEventHandler<HTMLButtonElement>
}

export type MenuItemProps = PropsWithChildren<{
  checked?: boolean
  className?: string
  icon?: ReactNode
  onClick?: () => void
  subTrigger?: boolean
}>

export type MenuDropdownProps = PropsWithChildren<{
  className?: string
  sub?: boolean
}>

export type RenderSideMenuOptions = {
  locale?: 'en' | 'it-IT'
}

export type TestRect = {
  height: number
  left: number
  top: number
  width: number
}

export type MockEditor = {
  document: MockBlock[]
  domElement: HTMLElement
  focus: ReturnType<typeof vi.fn>
  getBlock: ReturnType<typeof vi.fn>
  insertBlocks: ReturnType<typeof vi.fn>
  onChange: ReturnType<typeof vi.fn>
  removeBlocks: ReturnType<typeof vi.fn>
  setTextCursorPosition: ReturnType<typeof vi.fn>
  settings: { tables: { headers: boolean } }
  transact: ReturnType<typeof vi.fn>
  updateBlock: ReturnType<typeof vi.fn>
}

export let mockEditor: MockEditor
export let mockSideMenu: {
  blockDragEnd: ReturnType<typeof vi.fn>
  blockDragStart: ReturnType<typeof vi.fn>
  freezeMenu: ReturnType<typeof vi.fn>
  unfreezeMenu: ReturnType<typeof vi.fn>
}
export let mockSuggestionMenu: { openSuggestionMenu: ReturnType<typeof vi.fn> }
export let sideMenuBlock: MockBlock | undefined
const originalElementsFromPoint = document.elementsFromPoint
export const turnIntoButtonLabels = [
  'Paragraph',
  'Heading 1',
  'Heading 2',
  'Heading 3',
  'Heading 4',
  'Heading 5',
  'Heading 6',
  'Quote',
  'Bullet List',
  'Numbered List',
  'Checklist',
  'Code Block',
]

export function installPointerEventSupport() {
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
}

export function targetBlockId(block: MockBlock | string) {
  return typeof block === 'string' ? block : block.id
}

export function staleBlockError(block: MockBlock | string) {
  return new Error(`Block with ID ${targetBlockId(block)} not found`)
}

export function requireLiveBlock(block: MockBlock | string) {
  const liveBlock = mockEditor.getBlock(targetBlockId(block))
  if (!liveBlock) throw staleBlockError(block)
  return liveBlock
}

function mockMenuDropdown({ children, className, sub }: MenuDropdownProps) {
  return <div className={className} data-testid={sub ? 'menu-sub-dropdown' : 'menu-dropdown'}>{children}</div>
}

function mockMenuItem({ children, icon, onClick, subTrigger }: MenuItemProps) {
  return (
    <button
      aria-haspopup={subTrigger ? 'menu' : undefined}
      data-sub-trigger={subTrigger ? 'true' : undefined}
      type="button"
      onClick={onClick}
    >
      {icon ? <span data-testid={`menu-item-icon-${String(children)}`}>{icon}</span> : null}
      {children}
    </button>
  )
}

function mockMenuRoot({
  children,
  onOpenChange,
  sub,
}: PropsWithChildren<{ onOpenChange?: (open: boolean) => void; sub?: boolean }>) {
  return (
    <div
      data-testid={sub ? 'menu-sub-root' : 'menu-root'}
      onClick={() => onOpenChange?.(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpenChange?.(true)
      }}
      role="menu"
      tabIndex={0}
    >
      {children}
    </div>
  )
}

function mockMenuTrigger({ children, sub }: PropsWithChildren<{ sub?: boolean }>) {
  return <div data-testid={sub ? 'menu-sub-trigger' : 'menu-trigger'}>{children}</div>
}

function mockSideMenuButton({ draggable, label, onClick, onDragEnd, onDragStart }: SideMenuButtonProps) {
  return (
    <button
      type="button"
      draggable={draggable}
      onClick={onClick}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
    >
      {label}
    </button>
  )
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
    <button
      type="button"
      onClick={() => {
        if (sideMenuBlock) mockEditor.removeBlocks([sideMenuBlock])
      }}
    >
      {children}
    </button>
  ),
  SideMenu: ({ children }: PropsWithChildren) => <div data-testid="side-menu">{children}</div>,
  useBlockNoteEditor: () => mockEditor,
  useComponentsContext: () => ({
    Generic: {
      Menu: {
        Dropdown: mockMenuDropdown,
        Item: mockMenuItem,
        Root: mockMenuRoot,
        Trigger: mockMenuTrigger,
      },
    },
    SideMenu: {
      Button: mockSideMenuButton,
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

export function renderSideMenuWithBlock(block: MockBlock | undefined, options: RenderSideMenuOptions = {}) {
  sideMenuBlock = block
  const locale = options.locale ?? 'en'
  render(<TolariaSideMenu locale={locale} />)
}

export function renderSideMenuAndCollapseControllerWithBlock(block: MockBlock | undefined, options: RenderSideMenuOptions = {}) {
  sideMenuBlock = block
  const locale = options.locale ?? 'en'
  render(
    <>
      <TolariaCollapsedHeadingsController />
      <TolariaSideMenu locale={locale} />
    </>,
  )
}

export function rect({ height, left, top, width }: TestRect) {
  return DOMRect.fromRect({ x: left, y: top, width, height })
}

export function blockElement(id: string, bounds: DOMRect) {
  const element = document.createElement('div')
  element.dataset.id = id
  element.dataset.nodeType = 'blockContainer'
  element.getBoundingClientRect = vi.fn(() => bounds)
  return element
}

export function blockOuterElement(block: MockBlock) {
  const outer = document.createElement('div')
  outer.className = 'bn-block-outer'
  outer.dataset.id = block.id
  outer.dataset.nodeType = 'blockOuter'

  const blockContainer = document.createElement('div')
  blockContainer.className = 'bn-block'
  blockContainer.dataset.id = block.id
  blockContainer.dataset.nodeType = 'blockContainer'
  const blockContent = document.createElement('div')
  blockContent.className = 'bn-block-content'
  blockContent.dataset.contentType = block.type

  if (block.type === 'heading') {
    const level = Number(block.props?.level ?? 1)
    blockContent.dataset.level = String(level)
    const heading = document.createElement(`h${level}`)
    heading.className = 'bn-inline-content'
    heading.textContent = String(block.content ?? block.id)
    blockContent.appendChild(heading)
  } else if (block.type === 'divider') {
    blockContent.appendChild(document.createElement('hr'))
  } else {
    const inlineContent = document.createElement('div')
    inlineContent.className = 'bn-inline-content'
    inlineContent.textContent = Array.isArray(block.content)
      ? block.content.join('')
      : String(block.content ?? block.id)
    blockContent.appendChild(inlineContent)
  }

  blockContainer.appendChild(blockContent)
  outer.appendChild(blockContainer)
  return outer
}

export function appendBlockOuters(blocks: MockBlock[]) {
  for (const block of blocks) {
    mockEditor.domElement.appendChild(blockOuterElement(block))
    if (Array.isArray(block.children)) appendBlockOuters(block.children)
  }
}

export function placeEditorInScrollArea(scrollTop: number) {
  const scrollArea = document.createElement('div')
  scrollArea.className = 'editor-scroll-area'
  scrollArea.scrollTop = scrollTop
  scrollArea.appendChild(mockEditor.domElement)
  document.body.appendChild(scrollArea)
  return scrollArea
}

export function collapsedSectionStyleText() {
  return Array.from(document.head.querySelectorAll('style[data-tolaria-collapsed-sections]'))
    .map((styleElement) => styleElement.textContent ?? '')
    .join('\n')
}

export function expectCollapsedSectionStyleToTarget(blockId: string) {
  expect(collapsedSectionStyleText()).toContain(`[data-id="${blockId}"]`)
}

export function expectCollapsedSectionStyleNotToTarget(blockId: string) {
  expect(collapsedSectionStyleText()).not.toContain(`[data-id="${blockId}"]`)
}

export function dispatchPointerEvent(
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

export function testBlock(id: string, type: string, content: unknown): MockBlock {
  return { id, type, content, children: [] }
}

export function headingBlock(id: string, level: number): MockBlock {
  return { id, type: 'heading', props: { level }, content: [id], children: [] }
}

export function listItemBlock(id: string, children: MockBlock[] = []): MockBlock {
  return { id, type: 'bulletListItem', content: [id], children }
}

export function dispatchHandlePointerReorder(dragHandle: HTMLElement) {
  dispatchPointerEvent(requireParentElement(dragHandle), 'pointerdown', { button: 0, clientX: 80, clientY: 90 })
  dispatchPointerEvent(document, 'pointermove', { clientX: 130, clientY: 122 })
  dispatchPointerEvent(document, 'pointerup', { clientX: 130, clientY: 122 })
}

export function requireParentElement(element: HTMLElement) {
  const parent = element.parentElement
  if (!parent) throw new Error('Expected test element to have a parent')
  return parent
}

export function rootSideMenuButtonText() {
  const sideMenu = screen.getByTestId('side-menu')
  return screen.getAllByRole('button')
    .filter((button) => button.closest('[data-testid="side-menu"]') === sideMenu)
    .filter((button) => !button.closest('[data-testid="menu-sub-dropdown"]'))
    .map((button) => button.textContent)
}

export function renderPointerReorderFixture() {
  const draggedBlock = testBlock('dragged-block', 'heading', ['Notes'])
  const targetBlock = testBlock('target-block', 'paragraph', ['Paragraph'])
  const draggedElement = blockElement(draggedBlock.id, rect({ left: 120, top: 80, width: 420, height: 40 }))
  const targetElement = blockElement(targetBlock.id, rect({ left: 120, top: 120, width: 420, height: 40 }))
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



export function setupSideMenuTest() {
  const editorElement = document.createElement('div')
  editorElement.className = 'bn-editor'
  editorElement.getBoundingClientRect = vi.fn(() => rect({ left: 100, top: 50, width: 500, height: 400 }))
  document.body.appendChild(editorElement)

  sideMenuBlock = {
    id: 'stale-block',
    type: 'paragraph',
    content: ['old text'],
    children: [],
  }
  mockEditor = {
    document: [],
    domElement: editorElement,
    focus: vi.fn(),
    getBlock: vi.fn(() => undefined),
    insertBlocks: vi.fn((_blocks, block: MockBlock | string) => {
      requireLiveBlock(block)
      return [{ id: 'inserted-block', type: 'paragraph', content: [] }]
    }),
    onChange: vi.fn(() => vi.fn()),
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
}

export function cleanupSideMenuTest() {
  cleanup()
  document.elementsFromPoint = originalElementsFromPoint
  document.body.innerHTML = ''
  document.head.querySelectorAll('style[data-tolaria-collapsed-sections]')
    .forEach((styleElement) => {
      styleElement.remove()
    })
}
