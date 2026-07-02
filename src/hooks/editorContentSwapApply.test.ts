import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackEvent } from '../lib/telemetry'
import {
  applyBlocksToEditor,
  applyBlocksToEditorProgressively,
  PROGRESSIVE_BLOCK_APPLY_CHUNK_SIZE,
  PROGRESSIVE_BLOCK_APPLY_THRESHOLD,
  PROGRESSIVE_INITIAL_BLOCK_APPLY_CHUNK_SIZE,
} from './editorContentSwapApply'

vi.mock('../lib/telemetry', () => ({
  trackEvent: vi.fn(),
}))

function makeFrameRef<T>(current: T) {
  return { current }
}

interface MockEditorOptions {
  replaceError?: Error
  replaceResult?: (next: unknown[]) => unknown[]
}

function makeEditor(options: MockEditorOptions = {}) {
  const {
    replaceError,
    replaceResult = next => next,
  } = options
  let documentBlocks: unknown[] = [{ id: 'current-block', type: 'paragraph', content: [], children: [] }]
  return {
    isEditable: true,
    get document() {
      return documentBlocks
    },
    replaceBlocks: vi.fn((_current: unknown[], next: unknown[]) => {
      if (replaceError) throw replaceError
      documentBlocks = replaceResult(next)
    }),
    insertBlocks: vi.fn((next: unknown[]) => {
      documentBlocks = [...documentBlocks, ...next]
      return next
    }),
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

function makeBlocks(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `block-${index}`,
    type: 'paragraph',
    content: [{ type: 'text', text: `Block ${index}`, styles: {} }],
    children: [],
  }))
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
    const editor = makeEditor({ replaceError: staleBlockError })
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

  it('mounts large documents progressively while keeping the editor locked until commit', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(document, 'querySelector').mockReturnValue({ scrollTop: 0 } as unknown as Element)
    const editor = makeEditor()
    const blocks = makeBlocks(PROGRESSIVE_BLOCK_APPLY_THRESHOLD + PROGRESSIVE_BLOCK_APPLY_CHUNK_SIZE)
    const suppressChangeRef = makeFrameRef(false)
    const editorContentPathRef = makeFrameRef<string | null>(null)

    const applied = await applyBlocksToEditorProgressively({
      blocks,
      editor: editor as never,
      editorContentPathRef,
      scrollTop: 42,
      suppressChangeRef,
      targetPath: 'large.md',
    })

    expect(applied).toBe(true)
    expect(editor.replaceBlocks).toHaveBeenCalledTimes(1)
    expect(editor.replaceBlocks).toHaveBeenCalledWith(
      expect.any(Array),
      blocks.slice(0, PROGRESSIVE_INITIAL_BLOCK_APPLY_CHUNK_SIZE),
    )
    expect(editor.insertBlocks).toHaveBeenCalledTimes(
      Math.ceil(
        (blocks.length - PROGRESSIVE_INITIAL_BLOCK_APPLY_CHUNK_SIZE)
          / PROGRESSIVE_BLOCK_APPLY_CHUNK_SIZE,
      ),
    )
    expect(editor.document).toHaveLength(blocks.length)
    expect(editor.isEditable).toBe(true)
    expect(suppressChangeRef.current).toBe(false)
    expect(editorContentPathRef.current).toBe('large.md')
  })

  it('falls back to whole-document HTML if progressive append loses its insertion reference', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0)
      return 1
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const editor = makeEditor({ replaceResult: () => [] })
    const blocks = makeBlocks(PROGRESSIVE_BLOCK_APPLY_THRESHOLD + PROGRESSIVE_BLOCK_APPLY_CHUNK_SIZE)
    const suppressChangeRef = makeFrameRef(false)
    const editorContentPathRef = makeFrameRef<string | null>(null)

    const applied = await applyBlocksToEditorProgressively({
      blocks,
      editor: editor as never,
      editorContentPathRef,
      scrollTop: 0,
      suppressChangeRef,
      targetPath: 'large.md',
    })

    expect(applied).toBe(true)
    expect(editor.insertBlocks).not.toHaveBeenCalled()
    expect(editor.blocksToHTMLLossy).toHaveBeenCalledWith(blocks)
    expect(editor._tiptapEditor.commands.setContent).toHaveBeenCalledWith('<p>Recovered content</p>')
    expect(editor.isEditable).toBe(true)
    expect(suppressChangeRef.current).toBe(false)
    expect(editorContentPathRef.current).toBe('large.md')
  })

  it('aborts progressive application between chunks without committing the partial document', async () => {
    let frameCount = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCount += 1
      callback(frameCount)
      return frameCount
    })
    const editor = makeEditor()
    const blocks = makeBlocks(PROGRESSIVE_BLOCK_APPLY_THRESHOLD + PROGRESSIVE_BLOCK_APPLY_CHUNK_SIZE)
    const suppressChangeRef = makeFrameRef(false)
    const editorContentPathRef = makeFrameRef<string | null>(null)

    const applied = await applyBlocksToEditorProgressively({
      blocks,
      editor: editor as never,
      editorContentPathRef,
      scrollTop: 0,
      suppressChangeRef,
      targetPath: 'aborted.md',
      shouldAbort: () => true,
    })

    expect(applied).toBe(false)
    expect(editor.replaceBlocks).toHaveBeenCalledTimes(1)
    expect(editor.insertBlocks).not.toHaveBeenCalled()
    expect(editor.document).toHaveLength(PROGRESSIVE_INITIAL_BLOCK_APPLY_CHUNK_SIZE)
    expect(editor.isEditable).toBe(true)
    expect(editorContentPathRef.current).toBeNull()
  })
})
