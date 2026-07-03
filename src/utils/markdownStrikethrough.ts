import { advanceMarkdownFence, type MarkdownFence, type MarkdownFenceScanOptions } from './markdownFences'

interface MarkdownSource {
  markdown: string
}

interface TextPosition {
  text: string
  index: number
}

const FENCE_SCAN_OPTIONS: MarkdownFenceScanOptions = {
  closingMustEndLine: false,
}
const ASCII_PLACEHOLDER_PREFIX = '@@TOLARIA_'
const ASCII_PLACEHOLDER_SUFFIX = '@@'
const UNICODE_PLACEHOLDER_START = '\u2039'
const UNICODE_PLACEHOLDER_END = '\u203A'

function isEscaped({ text, index }: TextPosition): boolean {
  let slashCount = 0
  for (let i = index - 1; i >= 0 && text.charAt(i) === '\\'; i--) slashCount += 1
  return slashCount % 2 === 1
}

function readRun(text: string, index: number, token: string): number {
  let length = 0
  while (text.charAt(index + length) === token) length += 1
  return length
}

function copyCodeSpan(line: string, index: number): { next: number; text: string } | null {
  if (line.charAt(index) !== '`' || isEscaped({ text: line, index })) return null

  const markerLength = readRun(line, index, '`')
  const marker = '`'.repeat(markerLength)
  const end = line.indexOf(marker, index + markerLength)
  if (end === -1) return null

  return {
    next: end + markerLength,
    text: line.slice(index, end + markerLength),
  }
}

function copyPlaceholder(line: string, index: number): { next: number; text: string } | null {
  if (line.startsWith(ASCII_PLACEHOLDER_PREFIX, index)) {
    const end = line.indexOf(ASCII_PLACEHOLDER_SUFFIX, index + ASCII_PLACEHOLDER_PREFIX.length)
    return end === -1 ? null : {
      next: end + ASCII_PLACEHOLDER_SUFFIX.length,
      text: line.slice(index, end + ASCII_PLACEHOLDER_SUFFIX.length),
    }
  }

  if (line.startsWith(UNICODE_PLACEHOLDER_START, index)) {
    const end = line.indexOf(UNICODE_PLACEHOLDER_END, index + UNICODE_PLACEHOLDER_START.length)
    return end === -1 ? null : {
      next: end + UNICODE_PLACEHOLDER_END.length,
      text: line.slice(index, end + UNICODE_PLACEHOLDER_END.length),
    }
  }

  return null
}

function escapeSingleTildesInLine(line: string): string {
  let result = ''
  let index = 0

  while (index < line.length) {
    const placeholder = copyPlaceholder(line, index)
    if (placeholder) {
      result += placeholder.text
      index = placeholder.next
      continue
    }

    const codeSpan = copyCodeSpan(line, index)
    if (codeSpan) {
      result += codeSpan.text
      index = codeSpan.next
      continue
    }

    const tildeLength = readRun(line, index, '~')
    if (tildeLength === 1 && !isEscaped({ text: line, index })) {
      result += '\\~'
      index += 1
      continue
    }
    if (tildeLength > 1) {
      result += '~'.repeat(tildeLength)
      index += tildeLength
      continue
    }

    result += line.charAt(index)
    index += 1
  }

  return result
}

export function preProcessSingleTildeStrikethrough({ markdown }: MarkdownSource): string {
  let fence: MarkdownFence | null = null

  return markdown.split('\n').map((line) => {
    const nextFence = advanceMarkdownFence(line, fence, FENCE_SCAN_OPTIONS)
    if (fence !== null || nextFence !== fence) {
      fence = nextFence
      return line
    }

    return escapeSingleTildesInLine(line)
  }).join('\n')
}
