import type { FrontmatterValue } from '../components/Inspector'
import { canonicalFrontmatterKey } from './systemMetadata'

export interface ParsedFrontmatter {
  [key: string]: FrontmatterValue
}

type MarkdownContent = string
type FrontmatterBody = string
type FrontmatterLine = string
type FrontmatterKey = string
type FrontmatterText = string

export interface FrontmatterCollisionWarning {
  key: string
  labels: string[]
}

export interface FrontmatterWarnings {
  collidingProperties: FrontmatterCollisionWarning[]
}

const FRONTMATTER_CLOSE_DELIMITER = /(?:^|\r?\n)---(?:\r?\n|$)/

function unquote(s: FrontmatterText): FrontmatterText {
  return s.replace(/^["']|["']$/g, '')
}

function collapseList(items: FrontmatterText[]): FrontmatterValue {
  return items.length === 1 ? items[0] : items
}

function isBlockScalar(value: FrontmatterText): value is '|' | '>' {
  return value === '|' || value === '>'
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
  if (clean === value && isNumericScalar(clean)) return Number(clean)
  return clean
}

function isNumericScalar(value: FrontmatterText): boolean {
  if (!value) return false
  const unsigned = value.startsWith('-') ? value.slice(1) : value
  if (!unsigned) return false
  const parts = unsigned.split('.')
  return (parts.length === 1 || parts.length === 2)
    && parts.every((part) => part.length > 0 && [...part].every((char) => char >= '0' && char <= '9'))
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

function parseTopLevelKey(line: FrontmatterLine): FrontmatterKey | null {
  if (line.trim() === '' || line.startsWith(' ') || line.startsWith('\t')) return null
  return parseKeyValueLine(line)?.key ?? null
}

function frontmatterCollisionKey(key: FrontmatterKey): FrontmatterKey {
  return canonicalFrontmatterKey(key)
}

function addCollisionCandidate(
  groups: Map<FrontmatterKey, { labels: FrontmatterKey[]; count: number }>,
  key: FrontmatterKey,
) {
  const collisionKey = frontmatterCollisionKey(key)
  const group = groups.get(collisionKey) ?? { labels: [], count: 0 }
  group.count += 1
  if (!group.labels.includes(key)) group.labels.push(key)
  groups.set(collisionKey, group)
}

function assignFrontmatterValue(
  result: ParsedFrontmatter,
  collisionKeys: Map<FrontmatterKey, FrontmatterKey>,
  key: FrontmatterKey,
  value: FrontmatterValue,
) {
  const collisionKey = frontmatterCollisionKey(key)
  const previousKey = collisionKeys.get(collisionKey)
  if (previousKey && previousKey !== key) Reflect.deleteProperty(result, previousKey)
  collisionKeys.set(collisionKey, key)
  Reflect.set(result, key, value)
}

function parseFrontmatterValue(value: FrontmatterText): FrontmatterValue | undefined {
  if (isBlockScalar(value)) return undefined
  if (isInlineArrayLiteral(value)) return parseInlineArray(value)
  return parseScalar(value)
}

function flushList(
  result: ParsedFrontmatter,
  collisionKeys: Map<FrontmatterKey, FrontmatterKey>,
  currentKey: FrontmatterKey | null,
  currentList: FrontmatterText[],
): FrontmatterText[] {
  if (currentKey && currentList.length > 0) {
    assignFrontmatterValue(result, collisionKeys, currentKey, collapseList(currentList))
  }
  return []
}

function joinBlockScalar(mode: '|' | '>', rawLines: FrontmatterText[]): FrontmatterValue {
  let indent = 0
  for (const raw of rawLines) {
    if (raw.trim() === '') continue
    indent = raw.length - raw.trimStart().length
    break
  }
  const prefix = ' '.repeat(indent)
  const stripped = rawLines.map((raw) => (raw.startsWith(prefix) ? raw.slice(indent) : raw))
  const trimmed = [...stripped]
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') trimmed.pop()
  if (trimmed.length === 0) return ''
  if (mode === '|') return `${trimmed.join('\n')}\n`

  const paragraphs: FrontmatterText[][] = []
  let current: FrontmatterText[] = []
  for (const line of trimmed) {
    if (line === '') {
      if (current.length > 0) { paragraphs.push(current); current = [] }
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) paragraphs.push(current)
  return `${paragraphs.map((p) => p.join(' ')).join('\n')}\n`
}

/** Parse YAML frontmatter from content */
export function parseFrontmatter(content: MarkdownContent | null): ParsedFrontmatter {
  const frontmatterBody = extractFrontmatterBody(content)
  if (frontmatterBody === null) return {}

  const result: ParsedFrontmatter = {}
  const collisionKeys = new Map<FrontmatterKey, FrontmatterKey>()
  let currentKey: FrontmatterKey | null = null
  let currentList: FrontmatterText[] = []
  let blockKey: FrontmatterKey | null = null
  let blockMode: '|' | '>' | null = null
  let blockLines: FrontmatterText[] = []
  const flushBlockScalar = (): void => {
    if (blockKey !== null && blockMode !== null) {
      assignFrontmatterValue(result, collisionKeys, blockKey, joinBlockScalar(blockMode, blockLines))
    }
    blockKey = null
    blockMode = null
    blockLines = []
  }

  for (const line of frontmatterBody.split(/\r?\n/)) {
    if (blockKey !== null) {
      if (line === '' || line.startsWith(' ') || line.startsWith('\t')) {
        blockLines.push(line)
        continue
      }
      flushBlockScalar()
    }

    const listItem = parseListItem(line)
    if (listItem !== null && currentKey) {
      currentList.push(listItem)
      continue
    }

    currentList = flushList(result, collisionKeys, currentKey, currentList)

    const keyValue = parseKeyValueLine(line)
    if (!keyValue) continue
    currentKey = keyValue.key

    if (isBlockScalar(keyValue.value)) {
      blockKey = keyValue.key
      blockMode = keyValue.value
      blockLines = []
      continue
    }

    const parsedValue = parseFrontmatterValue(keyValue.value)
    if (parsedValue !== undefined) {
      assignFrontmatterValue(result, collisionKeys, currentKey, parsedValue)
    }
  }

  flushBlockScalar()
  flushList(result, collisionKeys, currentKey, currentList)
  return result
}

export function detectFrontmatterWarnings(content: MarkdownContent | null): FrontmatterWarnings {
  const frontmatterBody = extractFrontmatterBody(content)
  if (frontmatterBody === null) return { collidingProperties: [] }

  const groups = new Map<FrontmatterKey, { labels: FrontmatterKey[]; count: number }>()
  for (const line of frontmatterBody.split(/\r?\n/)) {
    const key = parseTopLevelKey(line)
    if (key) addCollisionCandidate(groups, key)
  }

  const collidingProperties = Array.from(groups.entries())
    .filter(([, group]) => group.count > 1)
    .map(([key, group]) => ({ key, labels: group.labels }))

  return { collidingProperties }
}

export function hasFrontmatterWarnings(warnings: FrontmatterWarnings): boolean {
  return warnings.collidingProperties.length > 0
}
