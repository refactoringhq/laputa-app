import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackEvent } from '../lib/telemetry'
import { applyBlocksToEditor } from './editorContentSwapApply'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

function makeFrameRef<T>(current: T) {
  return { current }
}

function makeEditor(replaceError?: Error) {
  const currentBlocks = [{ id: 'current-block', type: 'paragraph', content: [], children: [] }]
  return {
    document: currentBlocks,
    replaceBlocks: vi.fn(() => {
      if (replaceError) throw replaceError
    }),
    insertBlocks: vi.fn(),
    blocksToHTMLLossy: vi.fn(() => '<p>Recovered content</p>'),
    _tiptapEditor: {
      state: { doc: { content: { size: 4 } } },
      commands: {
        setContent: vi.fn(),
        setTextSelection: vi.fn(),
      },
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('applyBlocksToEditor', () => {
  it('recovers stale BlockNote block references without reporting a note-open swap error', () => {
    const staleBlockError = new Error('Block with ID 49c0b2e9-3c7e-47a6-954a-da98714f7ed0 not found')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const editor = makeEditor(staleBlockError)
    const nextBlocks = [{ id: 'next-block', type: 'paragraph', content: [], children: [] }]

    const applied = applyBlocksToEditor({
      blocks: nextBlocks,
      editor: editor as never,
      editorContentPathRef: makeFrameRef<string | null>(null),
      scrollTop: 0,
      suppressChangeRef: makeFrameRef(false),
      targetPath: 'next.md',
    })

    expect(applied).toBe(true)
    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleWarn).toHaveBeenCalledWith(
      '[editor] Recovered rich-editor content swap:',
      staleBlockError,
    )
    expect(trackEvent).toHaveBeenCalledWith('rich_editor_transform_error_recovered', {
      reason: 'stale_block_reference',
    })
    expect(editor.blocksToHTMLLossy).toHaveBeenCalledWith(nextBlocks)
    expect(editor._tiptapEditor.commands.setContent).toHaveBeenCalledWith('<p>Recovered content</p>')
  })
})
