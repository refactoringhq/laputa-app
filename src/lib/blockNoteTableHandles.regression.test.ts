import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  TableHandlesExtension,
  TableHandlesView,
} from '@blocknote/core/extensions'

function createTableBlock() {
  return {
    id: 'table-block',
    type: 'table',
    content: {
      type: 'tableContent',
      rows: [
        { cells: ['Head 1', 'Head 2'] },
        { cells: ['A', 'B'] },
      ],
    },
  }
}

function createRect({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  } as DOMRect
}

function createTableDom(blockId = 'stale-table-block') {
  const editorRoot = document.createElement('div')
  const blockContainer = document.createElement('div')
  const tableWrapper = document.createElement('div')
  const table = document.createElement('table')
  const tbody = document.createElement('tbody')
  const row = document.createElement('tr')
  const cell = document.createElement('td')

  blockContainer.setAttribute('data-node-type', 'blockContainer')
  blockContainer.setAttribute('data-id', blockId)
  tableWrapper.className = 'tableWrapper'
  tableWrapper.getBoundingClientRect = vi.fn(() => createRect({ left: 10, top: 10, width: 180, height: 80 }))
  tbody.getBoundingClientRect = vi.fn(() => createRect({ left: 10, top: 10, width: 180, height: 80 }))

  row.appendChild(cell)
  tbody.appendChild(row)
  table.appendChild(tbody)
  tableWrapper.appendChild(table)
  blockContainer.appendChild(tableWrapper)
  editorRoot.appendChild(blockContainer)
  document.body.appendChild(editorRoot)

  return { cell, editorRoot }
}

function createSelectionStateThatRejectsNaNPositions() {
  const selectionTransaction = {
    setSelection: vi.fn(),
  }
  const resolvedPosition = {
    posAtIndex: vi.fn((index: number) => index),
  }

  return {
    doc: {
      resolve: vi.fn((position: number) => {
        if (!Number.isFinite(position)) {
          throw new Error(`Position ${position} out of range`)
        }

        return resolvedPosition
      }),
    },
    tr: selectionTransaction,
    apply: vi.fn(),
  }
}

function mountTableHandlesExtension() {
  const editorRoot = document.createElement('div')
  document.body.appendChild(editorRoot)

  const selectionState = createSelectionStateThatRejectsNaNPositions()
  const dispatch = vi.fn()
  const editor = {
    headless: true,
    isEditable: true,
    prosemirrorView: {
      root: document,
    },
    exec: vi.fn((command: (state: never, dispatch: never) => unknown) =>
      command(selectionState as never, dispatch as never),
    ),
    transact: vi.fn(),
  }

  const extension = TableHandlesExtension()({ editor: editor as never })
  const plugin = extension.prosemirrorPlugins?.[0]

  if (!plugin?.spec.view) {
    throw new Error('TableHandlesExtension did not register a plugin view')
  }

  const view = plugin.spec.view({
    dom: editorRoot,
    root: document,
  } as never) as TableHandlesView

  return { editor, extension, view, selectionState }
}

function showTableHandles(view: TableHandlesView) {
  view.state = {
    block: createTableBlock(),
    show: true,
    showAddOrRemoveRowsButton: true,
    showAddOrRemoveColumnsButton: true,
    rowIndex: 0,
    colIndex: 0,
    draggingState: undefined,
  } as never
}

function expectAddRowAndColumnActionsToStaySafe(
  extension: ReturnType<typeof mountTableHandlesExtension>['extension'],
  index: number,
) {
  expect(() =>
    extension.addRowOrColumn(index, { orientation: 'row', side: 'below' }),
  ).not.toThrow()
  expect(() =>
    extension.addRowOrColumn(index, { orientation: 'column', side: 'right' }),
  ).not.toThrow()
}

describe('BlockNote table handles regression', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('hides stale table handles instead of throwing when tbody is missing during update', () => {
    const block = createTableBlock()
    const editorRoot = document.createElement('div')
    document.body.appendChild(editorRoot)

    const editor = {
      getBlock: vi.fn(() => block),
    }
    const emitUpdate = vi.fn()

    const view = new TableHandlesView(
      editor as never,
      {
        dom: editorRoot,
        root: document,
      } as never,
      emitUpdate,
    )

    view.state = {
      block,
      show: true,
      showAddOrRemoveRowsButton: true,
      showAddOrRemoveColumnsButton: true,
      rowIndex: 0,
      colIndex: 0,
    } as never

    const staleTableWrapper = document.createElement('div')
    editorRoot.appendChild(staleTableWrapper)
    view.tableElement = staleTableWrapper

    expect(() => view.update()).not.toThrow()
    expect(view.state?.show).toBe(false)
    expect(view.state?.showAddOrRemoveRowsButton).toBe(false)
    expect(view.state?.showAddOrRemoveColumnsButton).toBe(false)
    expect(emitUpdate).toHaveBeenCalled()

    view.destroy()
  })

  it('hides stale table handles instead of throwing when a reload clears the hovered block', () => {
    const editorRoot = document.createElement('div')
    document.body.appendChild(editorRoot)

    const editor = {
      getBlock: vi.fn(),
    }
    const emitUpdate = vi.fn()

    const view = new TableHandlesView(
      editor as never,
      {
        dom: editorRoot,
        root: document,
      } as never,
      emitUpdate,
    )

    view.state = {
      block: undefined,
      show: true,
      showAddOrRemoveRowsButton: true,
      showAddOrRemoveColumnsButton: true,
      rowIndex: 0,
      colIndex: 0,
      draggingState: {
        draggedCellOrientation: 'row',
        originalIndex: 0,
        mousePos: 10,
      },
    } as never

    expect(() => view.update()).not.toThrow()
    expect(editor.getBlock).not.toHaveBeenCalled()
    expect(view.state?.show).toBe(false)
    expect(view.state?.showAddOrRemoveRowsButton).toBe(false)
    expect(view.state?.showAddOrRemoveColumnsButton).toBe(false)
    expect(view.state?.rowIndex).toBeUndefined()
    expect(view.state?.colIndex).toBeUndefined()
    expect(view.state?.draggingState).toBeUndefined()
    expect(emitUpdate).toHaveBeenCalled()

    view.destroy()
  })

  it('ignores stale table drag starts instead of throwing when hover state is unavailable', () => {
    const { editor, extension, view } = mountTableHandlesExtension()

    expect(() =>
      extension.colDragStart({ dataTransfer: null, clientX: 10 }),
    ).not.toThrow()
    expect(() =>
      extension.rowDragStart({ dataTransfer: null, clientY: 10 }),
    ).not.toThrow()
    expect(editor.transact).not.toHaveBeenCalled()

    view.destroy()
  })

  it('ignores stale table drag end events instead of throwing after state disappears', () => {
    const { extension, view } = mountTableHandlesExtension()

    expect(() => extension.dragEnd()).not.toThrow()

    view.destroy()
  })

  it('ignores add row or column actions when the selection target is stale', () => {
    const { editor, extension, view } = mountTableHandlesExtension()

    showTableHandles(view)
    view.tablePos = undefined

    expectAddRowAndColumnActionsToStaySafe(extension, 0)
    expect(editor.exec).not.toHaveBeenCalled()

    view.tablePos = 0

    expectAddRowAndColumnActionsToStaySafe(extension, Number.NaN)
    expect(editor.exec).not.toHaveBeenCalled()

    view.destroy()
  })

  it('hides table handles instead of throwing when hover lookup sees a stale block id', () => {
    const block = createTableBlock()
    const { cell, editorRoot } = createTableDom(block.id)
    const emitUpdate = vi.fn()
    const editor = {
      isEditable: true,
      transact: vi.fn(() => {
        throw new Error(`Block with ID ${block.id} not found`)
      }),
    }

    const view = new TableHandlesView(
      editor as never,
      {
        dom: editorRoot,
        root: document,
      } as never,
      emitUpdate,
    )

    view.state = {
      block,
      show: true,
      showAddOrRemoveRowsButton: true,
      showAddOrRemoveColumnsButton: true,
      rowIndex: 0,
      colIndex: 0,
      draggingState: undefined,
    } as never

    const event = new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 20,
      clientY: 20,
    })
    Object.defineProperty(event, 'target', { value: cell })

    expect(() => view.mouseMoveHandler(event)).not.toThrow()
    expect(editor.transact).toHaveBeenCalled()
    expect(view.state?.show).toBe(false)
    expect(view.state?.showAddOrRemoveRowsButton).toBe(false)
    expect(view.state?.showAddOrRemoveColumnsButton).toBe(false)
    expect(emitUpdate).toHaveBeenCalled()

    view.destroy()
  })

  it('cancels stale table drops instead of throwing when no hovered row or column is available', () => {
    const block = createTableBlock()
    const editorRoot = document.createElement('div')
    document.body.appendChild(editorRoot)

    const editor = {
      getBlock: vi.fn(() => block),
    }
    const emitUpdate = vi.fn()

    const view = new TableHandlesView(
      editor as never,
      {
        dom: editorRoot,
        root: document,
      } as never,
      emitUpdate,
    )

    view.state = {
      block,
      show: true,
      showAddOrRemoveRowsButton: true,
      showAddOrRemoveColumnsButton: true,
      referencePosTable: {
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
      },
      rowIndex: undefined,
      colIndex: undefined,
      draggingState: {
        draggedCellOrientation: 'row',
        originalIndex: 0,
        mousePos: 10,
      },
      widgetContainer: undefined,
    } as never

    const dropEvent = {
      preventDefault: vi.fn(),
    }

    expect(() => view.dropHandler(dropEvent as never)).not.toThrow()
    expect(dropEvent.preventDefault).toHaveBeenCalled()
    expect(view.state?.draggingState).toBeUndefined()
    expect(view.state?.show).toBe(false)
    expect(view.state?.rowIndex).toBeUndefined()
    expect(view.state?.colIndex).toBeUndefined()
    expect(emitUpdate).toHaveBeenCalled()

    view.destroy()
  })
})
