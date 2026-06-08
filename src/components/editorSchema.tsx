/* eslint-disable react-refresh/only-export-components -- module-level schema, not a component file */
import {
  audioParse,
  createCodeBlockSpec,
  BlockNoteSchema,
  createAudioBlockConfig,
  createStyleSpec,
  createVideoBlockConfig,
  defaultInlineContentSpecs,
  videoParse,
} from '@blocknote/core'
import {
  AudioBlock,
  AudioToExternalHTML,
  createReactBlockSpec,
  createReactInlineContentSpec,
  VideoBlock,
  VideoToExternalHTML,
} from '@blocknote/react'
import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react'
import { resolveWikilinkColor as resolveColor } from '../utils/wikilinkColors'
import { resolveEntry } from '../utils/wikilink'
import { MATH_BLOCK_TYPE, MATH_INLINE_TYPE, renderMathToHtml } from '../utils/mathMarkdown'
import { MERMAID_BLOCK_TYPE, mermaidFenceSource } from '../utils/mermaidMarkdown'
import { TLDRAW_BLOCK_TYPE, TLDRAW_DEFAULT_HEIGHT } from '../utils/tldrawMarkdown'
import { MARKDOWN_HIGHLIGHT_STYLE } from '../utils/markdownHighlightMarkdown'
import type { VaultEntry } from '../types'
import { createTolariaCodeBlockOptions } from './codeBlockOptions'
import { NoteTitleIcon } from './NoteTitleIcon'
import { MermaidDiagram } from './MermaidDiagram'
import { SafeHtmlSpan } from './SafeMarkup'
import { updateTldrawBlockPropsSafely } from './tldrawBlockProps'
import { useExternalMediaPreview } from '../utils/mediaPreviewRuntime'
import { Textarea } from './ui/textarea'
import { dispatchRichEditorExternalChange } from './editorExternalChangeEvents'
import {
  isStaleBlockReferenceError,
  reportRecoveredEditorTransformError,
} from './richEditorTransformErrorRecoveryExtension'

const TldrawWhiteboard = lazy(() => import('./TldrawWhiteboard').then(module => ({
  default: module.TldrawWhiteboard,
})))
type AudioBlockProps = ComponentProps<typeof AudioBlock>
type VideoBlockProps = ComponentProps<typeof VideoBlock>
type MediaBlockPreviewProps = {
  block: {
    props: {
      showPreview: boolean
    }
  }
}

// Module-level cache so the WikiLink renderer (defined outside React) can access entries
export const _wikilinkEntriesRef: { current: VaultEntry[] } = { current: [] }

function resolveWikilinkColor(target: string) {
  return resolveColor(_wikilinkEntriesRef.current, target)
}

/** Resolve the display text and optional note icon for a wikilink target.
 *  Priority: pipe display text → entry title → humanised path stem */
function resolveDisplayInfo(target: string): { text: string; icon: string | null } {
  const pipeIdx = target.indexOf('|')
  if (pipeIdx !== -1) {
    const entry = resolveEntry(_wikilinkEntriesRef.current, target.slice(0, pipeIdx))
    return { text: target.slice(pipeIdx + 1), icon: entry?.icon ?? null }
  }
  const entry = resolveEntry(_wikilinkEntriesRef.current, target)
  if (entry) {
    return { text: entry.title, icon: entry.icon ?? null }
  }
  const last = target.split('/').pop() ?? target
  return { text: last.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), icon: null }
}

export const WikiLink = createReactInlineContentSpec(
  {
    type: "wikilink" as const,
    propSchema: {
      target: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => {
      const target = props.inlineContent.props.target
      const { color, isBroken } = resolveWikilinkColor(target)
      const { text, icon } = resolveDisplayInfo(target)
      return (
        <span
          className={`wikilink${isBroken ? ' wikilink--broken' : ''}`}
          data-target={target}
          style={{ color }}
        >
          <NoteTitleIcon icon={icon} size={14} className="mr-1 align-middle" />
          {text}
        </span>
      )
    },
  }
)

function MathRender({ latex, displayMode }: { latex: string; displayMode: boolean }) {
  const source = displayMode ? `$$\n${latex}\n$$` : `$${latex}$`
  return (
    <SafeHtmlSpan
      aria-label={`Math: ${latex}`}
      className={displayMode ? 'math math--block' : 'math math--inline'}
      data-latex={latex}
      markup={renderMathToHtml({ latex, displayMode })}
      role="img"
      title={source}
    />
  )
}

type MathBlockEditorProps = {
  block: {
    id: string
    props: {
      latex: string
    }
  }
  editor: {
    domElement?: EventTarget | null
    focus?: () => void
    updateBlock: (blockId: string, update: { props: { latex: string } }) => void
  }
}

function stopMathEditorEvent(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

function isCommandModifierPressed(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.metaKey || event.ctrlKey
}

function isCommitMathEditShortcut(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.key === 'Enter' && isCommandModifierPressed(event)
}

function updateMathBlockLatexSafely(
  editor: MathBlockEditorProps['editor'],
  blockId: string,
  latex: string,
) {
  try {
    editor.updateBlock(blockId, { props: { latex } })
    return true
  } catch (error) {
    if (!isStaleBlockReferenceError(error)) throw error

    reportRecoveredEditorTransformError('stale_block_reference', error)
    return false
  }
}

export function MathBlockEditor({ block, editor }: MathBlockEditorProps) {
  const currentLatex = block.props.latex
  const editingSessionRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [draftLatex, setDraftLatex] = useState(currentLatex)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) return
    textareaRef.current?.focus()
    textareaRef.current?.select()
  }, [editing])

  const startEditing = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault()
    event.stopPropagation()
    setDraftLatex(currentLatex)
    editingSessionRef.current = true
    setEditing(true)
  }

  const finishEditing = () => {
    if (!editingSessionRef.current) return
    editingSessionRef.current = false
    setEditing(false)
    if (draftLatex !== currentLatex) {
      const updated = updateMathBlockLatexSafely(editor, block.id, draftLatex)
      if (updated) dispatchRichEditorExternalChange(editor, editor.domElement ?? undefined)
    }
    editor.focus?.()
  }

  const cancelEditing = () => {
    if (!editingSessionRef.current) return
    editingSessionRef.current = false
    setDraftLatex(currentLatex)
    setEditing(false)
    editor.focus?.()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelEditing()
      return
    }

    if (isCommitMathEditShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      finishEditing()
    }
  }

  return (
    <div
      className={editing ? 'math-block-shell math-block-shell--editing' : 'math-block-shell'}
      onDoubleClick={editing ? stopMathEditorEvent : startEditing}
    >
      {editing ? (
        <div contentEditable={false} onMouseDown={stopMathEditorEvent}>
          <Textarea
            ref={textareaRef}
            aria-label={`Math: ${currentLatex}`}
            className="math-block-source min-h-24 font-mono text-sm selection:bg-[var(--colors-selection)] selection:text-[var(--colors-text)] focus-visible:ring-0"
            value={draftLatex}
            onBlur={finishEditing}
            onChange={(event) => setDraftLatex(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      ) : (
        <MathRender latex={currentLatex} displayMode />
      )}
    </div>
  )
}

export const MathInline = createReactInlineContentSpec(
  {
    type: MATH_INLINE_TYPE,
    propSchema: {
      latex: { default: '' },
    },
    content: 'none',
  },
  {
    render: (props) => (
      <MathRender latex={props.inlineContent.props.latex} displayMode={false} />
    ),
  },
)

const MathBlock = createReactBlockSpec(
  {
    type: MATH_BLOCK_TYPE,
    propSchema: {
      latex: { default: '' },
    },
    content: 'none',
  },
  {
    render: (props) => (
      <MathBlockEditor block={props.block} editor={props.editor} />
    ),
  },
)

function readCodeElementLanguage(code: Element): string | null {
  const language = code.getAttribute('data-language')
    ?? Array.from(code.classList)
      .find(className => className.startsWith('language-'))
      ?.replace(/^language-/u, '')
  if (!language) return null

  return language.trim().split(/\s+/u)[0]?.toLowerCase() ?? null
}

function readMermaidPreElement(element: HTMLElement): { source: string; diagram: string } | undefined {
  if (element.tagName !== 'PRE') return undefined
  if (element.childElementCount !== 1 || element.firstElementChild?.tagName !== 'CODE') return undefined

  const code = element.firstElementChild
  if (readCodeElementLanguage(code) !== 'mermaid') return undefined

  const diagram = code.textContent?.endsWith('\n')
    ? code.textContent
    : `${code.textContent ?? ''}\n`
  return {
    diagram,
    source: mermaidFenceSource({ diagram }),
  }
}

const MermaidBlock = createReactBlockSpec(
  {
    type: MERMAID_BLOCK_TYPE,
    propSchema: {
      source: { default: '' },
      diagram: { default: '' },
    },
    content: 'none',
  },
  {
    runsBefore: ['codeBlock'],
    parse: readMermaidPreElement,
    render: (props) => (
      <MermaidDiagram
        diagram={props.block.props.diagram}
        source={props.block.props.source}
      />
    ),
  },
)

export function mediaBlockPropsForPreviewRuntime<T extends MediaBlockPreviewProps>(
  props: T,
  externalMediaPreview: boolean,
): T {
  if (!externalMediaPreview) return props

  return {
    ...props,
    block: {
      ...props.block,
      props: {
        ...props.block.props,
        showPreview: false,
      },
    },
  }
}

export function TolariaAudioBlock(props: AudioBlockProps) {
  const externalMediaPreview = useExternalMediaPreview()
  return <AudioBlock {...mediaBlockPropsForPreviewRuntime(props, externalMediaPreview)} />
}

export function TolariaVideoBlock(props: VideoBlockProps) {
  const externalMediaPreview = useExternalMediaPreview()
  return <VideoBlock {...mediaBlockPropsForPreviewRuntime(props, externalMediaPreview)} />
}

const AudioBlockSpec = createReactBlockSpec(
  createAudioBlockConfig,
  (config) => ({
    render: TolariaAudioBlock,
    parse: audioParse(config),
    toExternalHTML: AudioToExternalHTML,
    runsBefore: ['file'],
  }),
)

const VideoBlockSpec = createReactBlockSpec(
  createVideoBlockConfig,
  (config) => ({
    render: TolariaVideoBlock,
    parse: videoParse(config),
    toExternalHTML: VideoToExternalHTML,
    runsBefore: ['file'],
  }),
)

const TldrawBlock = createReactBlockSpec(
  {
    type: TLDRAW_BLOCK_TYPE,
    propSchema: {
      boardId: { default: '' },
      height: { default: TLDRAW_DEFAULT_HEIGHT },
      snapshot: { default: '{}' },
      width: { default: '' },
    },
    content: 'none',
  },
  {
    runsBefore: ['codeBlock'],
    meta: { selectable: false },
    render: (props) => (
      <Suspense fallback={<div className="tldraw-whiteboard tldraw-whiteboard--loading" />}>
        <TldrawWhiteboard
          boardId={props.block.props.boardId}
          height={props.block.props.height}
          snapshot={props.block.props.snapshot}
          width={props.block.props.width}
          onSnapshotChange={(snapshot) => {
            updateTldrawBlockPropsSafely({
              blockId: props.block.id,
              editor: props.editor,
              nextProps: (currentProps) => ({
                ...currentProps,
                snapshot,
              }),
            })
          }}
          onSizeChange={(size) => {
            updateTldrawBlockPropsSafely({
              blockId: props.block.id,
              editor: props.editor,
              nextProps: (currentProps) => ({
                ...currentProps,
                height: size.height,
                width: size.width,
              }),
            })
          }}
        />
      </Suspense>
    ),
  },
)

const codeBlock = createCodeBlockSpec(createTolariaCodeBlockOptions())
const audioBlock = AudioBlockSpec()
const mathBlock = MathBlock()
const mermaidBlock = MermaidBlock()
const tldrawBlock = TldrawBlock()
const videoBlock = VideoBlockSpec()

function markdownHighlightElement(): { dom: HTMLElement; contentDOM: HTMLElement } {
  const mark = document.createElement('mark')
  mark.className = 'markdown-highlight'
  return { dom: mark, contentDOM: mark }
}

const MarkdownHighlightStyle = createStyleSpec(
  {
    type: MARKDOWN_HIGHLIGHT_STYLE,
    propSchema: 'boolean',
  },
  {
    render: markdownHighlightElement,
    toExternalHTML: markdownHighlightElement,
    parse: element => element.tagName === 'MARK' ? true : undefined,
  },
)

export const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    wikilink: WikiLink,
    mathInline: MathInline,
  },
}).extend({
  styleSpecs: {
    [MARKDOWN_HIGHLIGHT_STYLE]: MarkdownHighlightStyle,
  },
  blockSpecs: {
    audio: audioBlock,
    mathBlock,
    mermaidBlock,
    tldrawBlock,
    codeBlock,
    video: videoBlock,
  },
})
