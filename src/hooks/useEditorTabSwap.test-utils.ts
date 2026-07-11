import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import { useEditorTabSwap } from './useEditorTabSwap'

export const blocksA = [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }]

export function makeTextParagraphBlock(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] }
}

export function makeTab(path: string, title: string) {
  return {
    entry: { path, title, filename: `${title}.md`, type: 'Note', status: 'Active', aliases: [], isA: '' } as never,
    content: `---\ntitle: ${title}\n---\n\n# ${title}\n\nBody of ${title}.`,
  }
}

export function makeUntitledTab(path: string, title = 'Untitled Note 1', remainder = '') {
  return {
    entry: { path, title, filename: `${title}.md`, type: 'Note', status: 'Active', aliases: [], isA: '' } as never,
    content: `---\ntype: Note\nstatus: Active\n---\n\n# \n\n${remainder}`,
  }
}

export function makeBlankBodyTab(path: string, title = 'Untitled Note 1') {
  return {
    entry: { path, title, filename: `${title}.md`, type: 'Note', status: 'Active', aliases: [], isA: '' } as never,
    content: '---\ntype: Note\nstatus: Active\n---\n',
  }
}

export function makeMockEditor(docRef: { current: unknown[] }) {
  const editor = {
    document: docRef.current,
    get prosemirrorView() { return {} },
    onMount: (cb: () => void) => { cb(); return () => {} },
    replaceBlocks: vi.fn((_old, newBlocks) => { docRef.current = newBlocks }),
    insertBlocks: vi.fn(),
    blocksToMarkdownLossy: vi.fn(() => ''),
    blocksToHTMLLossy: vi.fn(() => ''),
    tryParseMarkdownToBlocks: vi.fn(() => blocksA),
    _tiptapEditor: {
      state: { doc: { content: { size: 8 } } },
      commands: {
        setContent: vi.fn(),
        setTextSelection: vi.fn(),
      },
    },
    _docRef: docRef,
  }
  Object.defineProperty(editor, 'document', { get: () => docRef.current })
  return editor
}

export function makeLongNoteBlocks(wordCount: number) {
  const words = Array.from({ length: wordCount }, (_, index) => `word${index}`)
  const paragraphs: unknown[] = []
  for (let index = 0; index < words.length; index += 20) {
    paragraphs.push({
      type: 'paragraph',
      content: [{ type: 'text', text: words.slice(index, index + 20).join(' '), styles: {} }],
      children: [],
    })
  }
  return paragraphs
}

export async function flushEditorTick() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

export function installEditorDomSpies(scrollTop = 0) {
  const scrollEl = { scrollTop }
  const frameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0
  })
  vi.spyOn(document, 'querySelector').mockReturnValue(scrollEl as unknown as Element)
  return { scrollEl, frameSpy }
}

export function flushQueuedFrames(frameCallbacks: FrameRequestCallback[]) {
  act(() => {
    for (const callback of frameCallbacks.splice(0)) {
      callback(0)
    }
  })
}

export type SwapHarnessProps = {
  tabs: ReturnType<typeof makeTab>[]
  activeTabPath: string | null
  rawMode?: boolean
  vaultPath?: string
}

export async function createSwapHarness(options: {
  initialProps: SwapHarnessProps
  onContentChange?: (path: string, content: string) => void
  setupEditor?: (editor: ReturnType<typeof makeMockEditor>) => void
}) {
  installEditorDomSpies()

  const docRef = { current: blocksA as unknown[] }
  const mockEditor = makeMockEditor(docRef)
  options.setupEditor?.(mockEditor)

  let currentProps = options.initialProps
  const rendered = renderHook(
    (props: SwapHarnessProps) => useEditorTabSwap({
      ...props,
      editor: mockEditor as never,
      onContentChange: options.onContentChange,
    }),
    { initialProps: currentProps },
  )

  await flushEditorTick()

  return {
    ...rendered,
    docRef,
    mockEditor,
    async rerenderWith(nextProps: Partial<SwapHarnessProps>) {
      currentProps = { ...currentProps, ...nextProps }
      rendered.rerender(currentProps)
      await flushEditorTick()
    },
  }
}
