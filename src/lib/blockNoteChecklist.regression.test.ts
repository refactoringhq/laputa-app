import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCheckListItemBlockSpec } from '../../node_modules/@blocknote/core/src/blocks/ListItem/CheckListItem/block'

const checkListItemSpec = createCheckListItemBlockSpec()

type CheckListItemBlock = Parameters<typeof checkListItemSpec.implementation.render>[0]
type CheckListItemEditor = Parameters<typeof checkListItemSpec.implementation.render>[1]
type RenderedCheckListItem = ReturnType<typeof checkListItemSpec.implementation.render>

type CheckListItemControlEditor = {
  getBlock: (id: string) => CheckListItemBlock | undefined
  updateBlock: (block: CheckListItemBlock, update: { props: { checked: boolean } }) => void
}

function createCheckListItem(checked = false): CheckListItemBlock {
  return {
    id: 'check-list-item-1',
    type: 'checkListItem',
    props: { checked },
    content: [],
    children: [],
  } as CheckListItemBlock
}

function renderCheckListItem(editor: CheckListItemControlEditor, checked = false) {
  const block = createCheckListItem(checked)
  const view = checkListItemSpec.implementation.render(
    block,
    editor as CheckListItemEditor,
  ) as RenderedCheckListItem
  const host = document.createElement('div')
  host.appendChild(view.dom)
  document.body.appendChild(host)

  const checkbox = host.querySelector('input[type="checkbox"]')
  if (!(checkbox instanceof HTMLInputElement)) throw new Error('Expected checklist checkbox')

  return { block, checkbox, host, view }
}

function dispatchChange(checkbox: HTMLInputElement) {
  checkbox.dispatchEvent(new window.Event('change'))
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('patched BlockNote checklist controls', () => {
  it('ignores stale checkbox changes when the target checklist block disappeared', () => {
    const editor: CheckListItemControlEditor = {
      getBlock: vi.fn(() => undefined),
      updateBlock: vi.fn(),
    }

    const { block, checkbox, view } = renderCheckListItem(editor)
    checkbox.checked = true
    dispatchChange(checkbox)

    expect(editor.getBlock).toHaveBeenCalledWith(block.id)
    expect(editor.updateBlock).not.toHaveBeenCalled()
    view.destroy?.()
  })

  it('applies live checkbox changes to the current checklist block', () => {
    const existingBlock = createCheckListItem()
    const editor: CheckListItemControlEditor = {
      getBlock: vi.fn(() => existingBlock),
      updateBlock: vi.fn(),
    }

    const { block, checkbox, view } = renderCheckListItem(editor)
    checkbox.checked = true
    dispatchChange(checkbox)

    expect(editor.getBlock).toHaveBeenCalledWith(block.id)
    expect(editor.updateBlock).toHaveBeenCalledWith(existingBlock, {
      props: { checked: true },
    })
    view.destroy?.()
  })
})
