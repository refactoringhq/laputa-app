import {
  readMarkdownHighlightPrefix,
  type MarkdownHighlightColor,
} from '../utils/markdownHighlightMarkdown'

const MARKDOWN_HIGHLIGHT_DELIMITER = '=='
const FINAL_MARKDOWN_HIGHLIGHT_INPUT = '='

export interface MarkdownHighlightCursorText {
  beforeText: string
  cursor: number
  parentStart: number
}

export interface MarkdownHighlightInputReplacement {
  closingFrom: number
  closingTo: number
  color: MarkdownHighlightColor
  contentFrom: number
  contentTo: number
  openingFrom: number
  openingTo: number
}

function hasValidHighlightContent(content: string): boolean {
  if (content.trim().length === 0) return false
  if (/^\s|\s$/.test(content)) return false
  return !/[\r\n]/.test(content)
}

export function readMarkdownHighlightInputReplacement({
  beforeText,
  cursor,
  parentStart,
}: MarkdownHighlightCursorText): MarkdownHighlightInputReplacement | null {
  const candidateText = `${beforeText}${FINAL_MARKDOWN_HIGHLIGHT_INPUT}`
  if (!candidateText.endsWith(MARKDOWN_HIGHLIGHT_DELIMITER)) return null

  const closingStart = candidateText.length - MARKDOWN_HIGHLIGHT_DELIMITER.length
  const openingStart = candidateText.lastIndexOf(MARKDOWN_HIGHLIGHT_DELIMITER, closingStart - 1)
  if (openingStart === -1) return null

  const unprefixedContentStart = openingStart + MARKDOWN_HIGHLIGHT_DELIMITER.length
  const candidateContent = candidateText.slice(unprefixedContentStart, closingStart)
  const prefixed = readMarkdownHighlightPrefix(candidateContent)
  const contentStart = unprefixedContentStart + candidateContent.length - prefixed.text.length
  if (!hasValidHighlightContent(prefixed.text)) return null

  const closingFrom = parentStart + closingStart
  if (cursor !== closingFrom + 1) return null

  return {
    closingFrom,
    closingTo: cursor,
    color: prefixed.color,
    contentFrom: parentStart + contentStart,
    contentTo: parentStart + closingStart,
    openingFrom: parentStart + openingStart,
    openingTo: parentStart + contentStart,
  }
}
