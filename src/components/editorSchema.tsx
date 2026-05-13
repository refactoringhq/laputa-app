/* eslint-disable react-refresh/only-export-components -- module-level schema, not a component file */
import {
  createCodeBlockSpec,
  BlockNoteSchema,
  defaultInlineContentSpecs,
} from '@blocknote/core'
import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react'
import { lazy, Suspense } from 'react'
import { resolveWikilinkColor as resolveColor } from '../utils/wikilinkColors'
import { resolveEntry } from '../utils/wikilink'
import { MATH_BLOCK_TYPE, MATH_INLINE_TYPE, renderMathToHtml } from '../utils/mathMarkdown'
import { MERMAID_BLOCK_TYPE, mermaidFenceSource } from '../utils/mermaidMarkdown'
import { TLDRAW_BLOCK_TYPE, TLDRAW_DEFAULT_HEIGHT } from '../utils/tldrawMarkdown'
import type { VaultEntry } from '../types'
import { createTolariaCodeBlockOptions } from './codeBlockOptions'
import { NoteTitleIcon } from './NoteTitleIcon'
import { MermaidDiagram } from './MermaidDiagram'
import { SafeHtmlSpan } from './SafeMarkup'
import { updateTldrawBlockPropsSafely } from './tldrawBlockProps'

const TldrawWhiteboard = lazy(() => import('./TldrawWhiteboard').then(module => ({
  default: module.TldrawWhiteboard,
})))

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
      <div className="math-block-shell">
        <MathRender latex={props.block.props.latex} displayMode />
      </div>
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
const mathBlock = MathBlock()
const mermaidBlock = MermaidBlock()
const tldrawBlock = TldrawBlock()

export const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    wikilink: WikiLink,
    mathInline: MathInline,
  },
}).extend({
  blockSpecs: {
    mathBlock,
    mermaidBlock,
    tldrawBlock,
    codeBlock,
  },
})
