import { describe, expect, it, vi } from 'vitest'
import {
  installCodeBlockLineNumbers,
  syncCodeBlockLineNumbers,
} from './codeBlockLineNumbers'

function codeBlock(text: string) {
  const block = document.createElement('div')
  block.dataset.contentType = 'codeBlock'
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = text
  pre.appendChild(code)
  block.appendChild(pre)
  return { block, code, pre }
}

describe('code block line numbers', () => {
  it('renders one non-editable gutter row per logical line', () => {
    const root = document.createElement('div')
    const layer = document.createElement('div')
    const fixture = codeBlock('one\ntwo\nthree')
    root.appendChild(fixture.block)

    syncCodeBlockLineNumbers(root, layer)

    const gutter = layer.querySelector('[data-code-line-numbers]')
    expect(gutter).toHaveAttribute('contenteditable', 'false')
    expect(gutter).toHaveTextContent('123')
    expect(gutter?.children).toHaveLength(3)
    expect(fixture.code.textContent).toBe('one\ntwo\nthree')
  })

  it('updates the gutter without duplicating it when code changes', async () => {
    const root = document.createElement('div')
    const host = document.createElement('div')
    const fixture = codeBlock('one')
    root.appendChild(fixture.block)
    host.appendChild(root)
    const controller = new AbortController()

    installCodeBlockLineNumbers(root, controller.signal)
    fixture.code.textContent = 'one\ntwo'
    await vi.waitFor(() => {
      expect(host.querySelectorAll('[data-code-line-numbers]')).toHaveLength(1)
      expect(host.querySelector('[data-code-line-numbers]')?.children).toHaveLength(2)
    })

    controller.abort()
    expect(host.querySelector('[data-code-line-numbers]')).toBeNull()
  })
})
