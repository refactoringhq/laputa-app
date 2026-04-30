import { createCodeBlockSpec } from '@blocknote/core'
import { codeBlockOptions } from '@blocknote/code-block'
import { afterEach, describe, expect, it, vi } from 'vitest'

const codeBlockSpec = createCodeBlockSpec({
  ...codeBlockOptions,
  defaultLanguage: 'text',
  supportedLanguages: {
    text: { name: 'Plain Text' },
    typescript: { name: 'TypeScript', aliases: ['ts'] },
  },
})

type CodeBlock = Parameters<typeof codeBlockSpec.implementation.render>[0]
type CodeBlockEditor = Parameters<typeof codeBlockSpec.implementation.render>[1]
type RenderedCodeBlock = ReturnType<typeof codeBlockSpec.implementation.render>

type CodeBlockControlEditor = {
  isEditable: boolean
  getBlock: (id: string) => CodeBlock | undefined
  updateBlock: (id: string, update: { props: { language: string } }) => void
}

function createCodeBlock(): CodeBlock {
  return {
    id: 'code-block-1',
    type: 'codeBlock',
    props: { language: 'text' },
    content: [],
    children: [],
  } as CodeBlock
}

function renderLanguageSelect(editor: CodeBlockControlEditor) {
  const block = createCodeBlock()
  const view = codeBlockSpec.implementation.render(
    block,
    editor as CodeBlockEditor,
  ) as RenderedCodeBlock
  const host = document.createElement('div')
  host.appendChild(view.dom)
  document.body.appendChild(host)

  const select = host.querySelector('select')
  if (!select) throw new Error('Expected code block language select')

  return { block, host, select, view }
}

function dispatchChange(select: HTMLSelectElement) {
  select.dispatchEvent(new window.Event('change'))
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('patched BlockNote code block controls', () => {
  it('ignores stale language changes when the target code block disappeared', () => {
    const editor: CodeBlockControlEditor = {
      isEditable: true,
      getBlock: vi.fn(() => undefined),
      updateBlock: vi.fn(),
    }

    const { block, select, view } = renderLanguageSelect(editor)
    select.value = 'typescript'
    dispatchChange(select)

    expect(editor.getBlock).toHaveBeenCalledWith(block.id)
    expect(editor.updateBlock).not.toHaveBeenCalled()
    view.destroy?.()
  })

  it('keeps live language changes wired to the code block update', () => {
    const existingBlock = createCodeBlock()
    const editor: CodeBlockControlEditor = {
      isEditable: true,
      getBlock: vi.fn(() => existingBlock),
      updateBlock: vi.fn(),
    }

    const { block, select, view } = renderLanguageSelect(editor)
    select.value = 'typescript'
    dispatchChange(select)

    expect(editor.getBlock).toHaveBeenCalledWith(block.id)
    expect(editor.updateBlock).toHaveBeenCalledWith(block.id, {
      props: { language: 'typescript' },
    })
    view.destroy?.()
  })
})
