import { act, fireEvent, screen } from '@testing-library/react'
import { BlockNoteEditor } from '@blocknote/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { schema } from './editorSchema'
import { subscribeRichEditorExternalChange } from './editorExternalChangeEvents'
import {
  injectMarkdownHighlightsInBlocks,
  serializeMarkdownHighlightAwareBlocks,
} from '../utils/markdownHighlightMarkdown'
import {
  applyMarkdownHighlightColor,
  mountMarkdownHighlightControls,
  readMarkdownHighlightRange,
  toggleDefaultMarkdownHighlight,
} from './markdownHighlightControls'

const { trackEventMock } = vi.hoisted(() => ({
  trackEventMock: vi.fn(),
}))

vi.mock('../lib/telemetry', () => ({
  trackEvent: trackEventMock,
}))

async function editorFromMarkdown(markdown: string) {
  const editor = BlockNoteEditor.create({ schema })
  const blocks = injectMarkdownHighlightsInBlocks(
    await editor.tryParseMarkdownToBlocks(markdown),
  ) as Parameters<typeof editor.replaceBlocks>[1]
  editor.replaceBlocks(editor.document, blocks)
  return editor
}

function selectText(editor: Awaited<ReturnType<typeof editorFromMarkdown>>, from: number, to = from) {
  editor._tiptapEditor.commands.setTextSelection({ from, to })
}

function textRange(editor: Awaited<ReturnType<typeof editorFromMarkdown>>, text: string) {
  let range: { from: number; to: number } | null = null
  editor.prosemirrorState.doc.descendants((node, position) => {
    if (range || !node.isText) return
    const index = node.text?.indexOf(text) ?? -1
    if (index !== -1) {
      range = { from: position + index, to: position + index + text.length }
    }
  })
  if (!range) throw new Error(`Text not found in editor: ${text}`)
  return range as { from: number; to: number }
}

afterEach(() => {
  document.body.innerHTML = ''
  trackEventMock.mockClear()
})

describe('Markdown highlight color controls', () => {
  it('finds the complete colored highlight boundary around a collapsed cursor', async () => {
    const editor = await editorFromMarkdown('==🔴red words==')
    const expectedRange = textRange(editor, 'red words')
    selectText(editor, expectedRange.from + 1)

    expect(readMarkdownHighlightRange(editor)).toEqual({
      color: 'red',
      ...expectedRange,
    })
  })

  it('recolors an existing boundary and persists the matching circle prefix', async () => {
    const editor = await editorFromMarkdown('==🔴red words==')
    const expectedRange = textRange(editor, 'red words')
    selectText(editor, expectedRange.from + 1)
    const range = readMarkdownHighlightRange(editor)
    expect(range).not.toBeNull()
    if (!range) throw new Error('Expected a highlight range at the cursor')

    applyMarkdownHighlightColor(editor, 'blue', range, 'cursor')

    expect(serializeMarkdownHighlightAwareBlocks(editor, editor.document)).toBe('==🔵red words==')
    expect(trackEventMock).toHaveBeenCalledWith('markdown_highlight_color_selected', {
      color: 'blue',
      source: 'cursor',
    })
  })

  it('notifies the durable editor pipeline after recoloring a boundary', async () => {
    const editor = await editorFromMarkdown('==🔴red words==')
    const expectedRange = textRange(editor, 'red words')
    selectText(editor, expectedRange.from + 1)
    const onExternalChange = vi.fn()
    const unsubscribe = subscribeRichEditorExternalChange(editor, onExternalChange)

    applyMarkdownHighlightColor(
      editor,
      'blue',
      readMarkdownHighlightRange(editor),
      'cursor',
    )

    expect(onExternalChange).toHaveBeenCalledOnce()
    unsubscribe()
  })

  it('uses yellow for the direct action and removes both marks when toggled off', async () => {
    const editor = await editorFromMarkdown('plain')
    const expectedRange = textRange(editor, 'plain')
    selectText(editor, expectedRange.from, expectedRange.to)

    toggleDefaultMarkdownHighlight(editor)
    expect(serializeMarkdownHighlightAwareBlocks(editor, editor.document)).toBe('==plain==')

    selectText(editor, expectedRange.from, expectedRange.to)
    toggleDefaultMarkdownHighlight(editor)
    expect(serializeMarkdownHighlightAwareBlocks(editor, editor.document)).toBe('plain')
  })

  it('mounts a shadcn color trigger beside the existing toolbar button and cleans it up', async () => {
    const editor = await editorFromMarkdown('plain')
    const container = document.createElement('div')
    container.className = 'editor__blocknote-container'
    const editorDom = document.createElement('div')
    const toolbar = document.createElement('div')
    toolbar.className = 'bn-formatting-toolbar'
    const highlightButton = document.createElement('button')
    highlightButton.dataset.test = 'highlight'
    toolbar.appendChild(highlightButton)
    container.append(editorDom, toolbar)
    document.body.appendChild(container)
    const controller = new AbortController()

    await act(async () => {
      mountMarkdownHighlightControls({
        dom: editorDom,
        editor,
        signal: controller.signal,
      })
    })

    expect(document.querySelector('[data-test="highlightColorMenu"]')).not.toBeNull()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Choose highlight color' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose highlight color' }))
    expect(screen.getByRole('menuitem', { name: 'Red' })).toBeVisible()

    await act(async () => controller.abort())
    expect(document.querySelector('[data-test="highlightColorMenu"]')).toBeNull()
  })
})
