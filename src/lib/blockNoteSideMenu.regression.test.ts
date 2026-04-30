import { afterEach, describe, expect, it, vi } from 'vitest'
import { SideMenuView } from '../../node_modules/@blocknote/core/src/extensions/SideMenu/SideMenu'

const originalElementsFromPoint = document.elementsFromPoint

function createRect({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function createStaleEditorDom() {
  const editor = document.createElement('div')
  editor.className = 'bn-editor'
  editor.getBoundingClientRect = vi.fn(() => createRect({ left: 0, top: 0, width: 480, height: 240 }))

  const blockGroup = document.createElement('div')
  blockGroup.className = 'bn-block-group'
  blockGroup.getBoundingClientRect = vi.fn(() => createRect({ left: 20, top: 20, width: 360, height: 160 }))

  const block = document.createElement('div')
  block.setAttribute('data-node-type', 'blockContainer')
  block.setAttribute('data-id', 'stale-table-block')
  block.getBoundingClientRect = vi.fn(() => createRect({ left: 20, top: 40, width: 260, height: 48 }))

  blockGroup.appendChild(block)
  editor.appendChild(blockGroup)
  document.body.appendChild(editor)

  return { block, editor }
}

describe('patched BlockNote side menu lifecycle', () => {
  afterEach(() => {
    document.elementsFromPoint = originalElementsFromPoint
    document.body.innerHTML = ''
  })

  it('does not publish side-menu state for a stale hovered block id', () => {
    const { block, editor } = createStaleEditorDom()
    document.elementsFromPoint = vi.fn(() => [block, editor])

    const updates: unknown[] = []
    const view = new SideMenuView(
      {
        getBlock: vi.fn(() => undefined),
        isEditable: true,
      } as never,
      {
        dom: editor,
        root: document,
      } as never,
      (state) => updates.push(state),
    )

    try {
      view.onMouseMove(new MouseEvent('mousemove', { clientX: 40, clientY: 50 }))

      expect(updates).toEqual([])
    } finally {
      view.destroy()
    }
  })
})
