import type { FrontmatterValue } from '../components/Inspector'

export interface ParsedFrontmatter {
  [key: string]: FrontmatterValue
}

type MarkdownContent = string
type FrontmatterBody = string
type FrontmatterLine = string
type FrontmatterKey = string
type FrontmatterText = string

const FRONTMATTER_CLOSE_DELIMITER = /(?:^|\r?\n)---(?:\r?\n|$)/

function unquote(s: FrontmatterText): FrontmatterText {
  return s.replace(/^["']|["']$/g, '')
}

function collapseList(items: FrontmatterText[]): FrontmatterValue {
  return items.length === 1 ? items[0] : items
}

function isBlockScalar(value: FrontmatterText): boolean {
  return value === '' || value === '|' || value === '>'
}

function isInlineArrayLiteral(value: FrontmatterText): boolean {
  return value.startsWith('[') && value.endsWith(']') && !value.startsWith('[[')
}

function parseInlineArray(value: FrontmatterText): FrontmatterValue {
  const items = value.slice(1, -1).split(',').map(s => unquote(s.trim()))
  return collapseList(items)
}

function parseScalar(value: FrontmatterText): FrontmatterValue {
  const clean = unquote(value)
  const lower = clean.toLowerCase()
  if (lower === 'true' || lower === 'yes') return true
  if (lower === 'false' || lower === 'no') return false
  if (clean === value && /^-?\d+(\.\d+)?$/.test(clean)) return Number(clean)
  return clean
}

export type FrontmatterState = 'valid' | 'empty' | 'none' | 'invalid'

function frontmatterContentStart(content: MarkdownContent): number | null {
  if (content.startsWith('---\r\n')) return 5
  if (content.startsWith('---\n')) return 4
  return null
}

function extractFrontmatterBody(content: MarkdownContent | null): FrontmatterBody | null {
  if (!content) return null
  const start = frontmatterContentStart(content)
  if (start === null) return null
  const rest = content.slice(start)
  const close = rest.match(FRONTMATTER_CLOSE_DELIMITER)
  if (!close || close.index === undefined) return null
  return rest.slice(0, close.index)
}

/** Detect whether content has valid, empty, missing, or invalid frontmatter. */
export function detectFrontmatterState(content: MarkdownContent | null): FrontmatterState {
  if (!content) return 'none'
  const frontmatterBody = extractFrontmatterBody(content)
  if (frontmatterBody === null) return 'none'
  const body = frontmatterBody.trim()
  if (!body) return 'empty'
  // Valid frontmatter needs at least one line starting with a word character followed by colon
  const hasValidLine = body.split(/\r?\n/).some(line => /^[A-Za-z][\w -]*:/.test(line))
  return hasValidLine ? 'valid' : 'invalid'
}

function parseListItem(line: FrontmatterLine): FrontmatterText | null {
  const match = line.match(/^ {2}- (.*)$/)
  return match ? unquote(match[1]) : null
}

function parseKeyValueLine(line: FrontmatterLine): { key: FrontmatterKey, value: FrontmatterText } | null {
  const match = line.match(/^["']?([^"':]+)["']?\s*:\s*(.*)$/)
  if (!match) return null
  return {
    key: match[1].trim(),
    value: match[2].trim(),
  }
}

function parseFrontmatterValue(value: FrontmatterText): FrontmatterValue | undefined {
  if (isBlockScalar(value)) return undefined
  if (isInlineArrayLiteral(value)) return parseInlineArray(value)
  return parseScalar(value)
}

function flushList(
  result: ParsedFrontmatter,
  currentKey: FrontmatterKey | null,
  currentList: FrontmatterText[],
): FrontmatterText[] {
  if (currentKey && currentList.length > 0) {
    result[currentKey] = collapseList(currentList)
  }
  return []
}

/** Parse YAML frontmatter from content */
export function parseFrontmatter(content: MarkdownContent | null): ParsedFrontmatter {
  const frontmatterBody = extractFrontmatterBody(content)
  if (frontmatterBody === null) return {}

  const result: ParsedFrontmatter = {}
  let currentKey: FrontmatterKey | null = null
  let currentList: FrontmatterText[] = []

  for (const line of frontmatterBody.split(/\r?\n/)) {
    const listItem = parseListItem(line)
    if (listItem !== null && currentKey) {
      currentList.push(listItem)
      continue
    }

    currentList = flushList(result, currentKey, currentList)

    const keyValue = parseKeyValueLine(line)
    if (!keyValue) continue
    currentKey = keyValue.key

    const parsedValue = parseFrontmatterValue(keyValue.value)
    if (parsedValue !== undefined) {
      result[currentKey] = parsedValue
    }
  }

  flushList(result, currentKey, currentList)
  return result
}
