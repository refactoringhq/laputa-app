export type MarkdownFenceCharacter = '`' | '~'

export interface MarkdownFence {
  character: MarkdownFenceCharacter
  length: number
}

export interface MarkdownFenceScanOptions {
  closingMustEndLine?: boolean
  maxLeadingSpaces?: number | null
}

const DEFAULT_MAX_LEADING_SPACES = 3

function fencePrefixPattern(options: MarkdownFenceScanOptions): RegExp {
  return options.maxLeadingSpaces === null
    ? /^(\s*)(`{3,}|~{3,})/u
    : /^( *)(`{3,}|~{3,})/u
}

function hasAllowedIndent(match: RegExpExecArray, options: MarkdownFenceScanOptions): boolean {
  if (options.maxLeadingSpaces === null) return true
  const maximum = options.maxLeadingSpaces ?? DEFAULT_MAX_LEADING_SPACES
  return (match.at(1)?.length ?? 0) <= maximum
}

function readFenceMatch(line: string, options: MarkdownFenceScanOptions): RegExpExecArray | null {
  const match = fencePrefixPattern(options).exec(line)
  return match && hasAllowedIndent(match, options) ? match : null
}

function fenceFromMatch(match: RegExpExecArray): MarkdownFence {
  const fence = match.at(2) ?? ''
  return {
    character: fence.charAt(0) as MarkdownFenceCharacter,
    length: fence.length,
  }
}

export function readMarkdownFence(
  line: string,
  options: MarkdownFenceScanOptions = {},
): MarkdownFence | null {
  const match = readFenceMatch(line, options)
  return match ? fenceFromMatch(match) : null
}

function closingTailIsAllowed(
  line: string,
  match: RegExpExecArray,
  options: MarkdownFenceScanOptions,
): boolean {
  if (options.closingMustEndLine === false) return true
  return /^[ \t]*$/u.test(line.slice(match[0].length))
}

function isClosingMarkdownFence(
  line: string,
  opening: MarkdownFence,
  options: MarkdownFenceScanOptions,
): boolean {
  const match = readFenceMatch(line, options)
  if (!match) return false

  const closing = fenceFromMatch(match)
  return closing.character === opening.character
    && closing.length >= opening.length
    && closingTailIsAllowed(line, match, options)
}

export function advanceMarkdownFence(
  line: string,
  current: MarkdownFence | null,
  options: MarkdownFenceScanOptions = {},
): MarkdownFence | null {
  if (current) {
    return isClosingMarkdownFence(line, current, options) ? null : current
  }
  return readMarkdownFence(line, options)
}

export function isInsideMarkdownFence(
  markdownBeforeCursor: string,
  options: MarkdownFenceScanOptions = {},
): boolean {
  let fence: MarkdownFence | null = null

  for (const line of markdownBeforeCursor.split(/\r?\n/u)) {
    fence = advanceMarkdownFence(line, fence, options)
  }

  return fence !== null
}
