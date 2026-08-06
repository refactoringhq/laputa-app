import { markdownHighlightColorFromStyles, type MarkdownHighlightColor } from '../utils/markdownHighlightMarkdown'
import type {
  HighlightEditor,
  HighlightRange,
  MarkdownHighlightRange,
} from './markdownHighlightModel'

type HighlightNode = Parameters<typeof nodeHighlightColor>[0]
type HighlightParent = {
  child(index: number): HighlightNode
  childCount: number
}

type HighlightedChild = {
  color: MarkdownHighlightColor
  index: number
  node: HighlightNode
  offset: number
}

type ChildCandidate = {
  index: number
  node?: HighlightNode | null
  offset: number
}

type HighlightRangeScan = {
  color: MarkdownHighlightColor
  index: number
  parent: HighlightParent
  position: number
}

function nodeHighlightColor(node: {
  marks: ReadonlyArray<{ attrs: Record<string, unknown>; type: { name: string } }>
  nodeSize: number
}): MarkdownHighlightColor | null {
  const highlighted = node.marks.some(mark => mark.type.name === 'highlight')
  if (!highlighted) return null

  const backgroundColor = node.marks.find(mark => mark.type.name === 'backgroundColor')
  return markdownHighlightColorFromStyles({
    backgroundColor: backgroundColor?.attrs.stringValue,
    highlight: true,
  })
}

function highlightedChild(candidate: ChildCandidate): HighlightedChild | null {
  if (!candidate.node) return null

  const color = nodeHighlightColor(candidate.node)
  return color ? { ...candidate, color, node: candidate.node } : null
}

function readAdjacentHighlight(editor: HighlightEditor): HighlightedChild | null {
  const position = editor.prosemirrorState.selection.$from
  const after = position.parent.childAfter(position.parentOffset)
  const highlightedAfter = highlightedChild(after)
  if (highlightedAfter) return highlightedAfter

  const before = position.parent.childBefore(position.parentOffset)
  return highlightedChild(before)
}

function scanIsInsideParent(scan: HighlightRangeScan, step: 1 | -1): boolean {
  return step < 0 ? scan.index > 0 : scan.index < scan.parent.childCount
}

function scannedChildIndex(scan: HighlightRangeScan, step: 1 | -1): number {
  return step < 0 ? scan.index - 1 : scan.index
}

function highlightRangeEdge(initial: HighlightRangeScan, step: 1 | -1): number {
  const scan = { ...initial }
  while (scanIsInsideParent(scan, step)) {
    const node = scan.parent.child(scannedChildIndex(scan, step))
    if (nodeHighlightColor(node) !== scan.color) break
    scan.index += step
    scan.position += node.nodeSize * step
  }

  return scan.position
}

export function readMarkdownHighlightRange(editor: HighlightEditor): MarkdownHighlightRange | null {
  const { selection } = editor.prosemirrorState
  if (selection.from !== selection.to) return null

  const position = selection.$from
  const adjacent = readAdjacentHighlight(editor)
  if (!adjacent) return null

  const initialFrom = position.start() + adjacent.offset
  return {
    color: adjacent.color,
    from: highlightRangeEdge({
      color: adjacent.color,
      index: adjacent.index,
      parent: position.parent,
      position: initialFrom,
    }, -1),
    to: highlightRangeEdge({
      color: adjacent.color,
      index: adjacent.index + 1,
      parent: position.parent,
      position: initialFrom + adjacent.node.nodeSize,
    }, 1),
  }
}

export function selectionOrHighlightRange(editor: HighlightEditor): HighlightRange | null {
  const { from, to } = editor.prosemirrorState.selection
  return from === to ? readMarkdownHighlightRange(editor) : { from, to }
}
