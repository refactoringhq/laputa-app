import type { FrontmatterValue } from '../components/Inspector'
import { canonicalFrontmatterWriteKey, frontmatterKeysMatch } from '../utils/systemMetadata'

type VaultPath = string
type MarkdownContent = string
type FrontmatterKey = string
type YamlKey = string
type YamlValue = string
type YamlLine = string
type ReplacementLine = string | null
type LineEnding = '\n' | '\r\n'

interface ParsedFrontmatter {
  fm: MarkdownContent
  rest: MarkdownContent
  lineEnding: LineEnding
}

function canonicalWriteKey(key: FrontmatterKey): FrontmatterKey {
  return canonicalFrontmatterWriteKey(key)
}

function formatYamlValue(value: FrontmatterValue): YamlValue {
  if (Array.isArray(value)) return '\n' + value.map(v => `  - "${v}"`).join('\n')
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null) return 'null'
  return String(value)
}

function formatYamlKey(key: FrontmatterKey): YamlKey {
  return key.includes(' ') ? `"${key}"` : key
}

function frontmatterOpening(content: MarkdownContent): { bodyStart: number; lineEnding: LineEnding } | null {
  if (content.startsWith('---\r\n')) return { bodyStart: 5, lineEnding: '\r\n' }
  if (content.startsWith('---\n')) return { bodyStart: 4, lineEnding: '\n' }
  return null
}

function parseFrontmatter(content: MarkdownContent): ParsedFrontmatter | null {
  const opening = frontmatterOpening(content)
  if (!opening) return null
  const afterOpening = content.slice(opening.bodyStart)
  if (afterOpening.startsWith('---')) {
    return { fm: '', rest: afterOpening.slice(3), lineEnding: opening.lineEnding }
  }

  const closeMarker = `${opening.lineEnding}---`
  const fmEnd = afterOpening.indexOf(closeMarker)
  if (fmEnd === -1) return null
  return {
    fm: afterOpening.slice(0, fmEnd),
    rest: afterOpening.slice(fmEnd + closeMarker.length),
    lineEnding: opening.lineEnding,
  }
}

function formatKeyValue(yamlKey: YamlKey, yamlValue: YamlValue, isArray: boolean): YamlLine {
  return isArray ? `${yamlKey}:${yamlValue}` : `${yamlKey}: ${yamlValue}`
}

function quotedYamlKey(raw: YamlLine, quote: '"' | "'"): FrontmatterKey | null {
  const rest = raw.slice(1)
  const end = rest.indexOf(quote)
  if (end === -1) return null
  return rest.slice(end + 1).trimStart().startsWith(':') ? rest.slice(0, end) : null
}

function isIndentedYamlLine(line: YamlLine): boolean {
  return line.startsWith(' ') || line.startsWith('\t')
}

function parseBareYamlKey(trimmed: YamlLine): FrontmatterKey | null {
  if (!trimmed.includes(':')) return null
  const [key] = trimmed.split(':', 1)
  return key.trim() || null
}

function parseTrimmedYamlKey(trimmed: YamlLine): FrontmatterKey | null {
  if (trimmed.startsWith('"')) return quotedYamlKey(trimmed, '"')
  if (trimmed.startsWith("'")) return quotedYamlKey(trimmed, "'")
  return parseBareYamlKey(trimmed)
}

function parseYamlKey(line: YamlLine): FrontmatterKey | null {
  if (isIndentedYamlLine(line)) return null
  const trimmed = line.trimStart()
  return parseTrimmedYamlKey(trimmed)
}

function lineMatchesKey(line: YamlLine, key: FrontmatterKey): boolean {
  const yamlKey = parseYamlKey(line)
  return yamlKey !== null && frontmatterKeysMatch(yamlKey, key)
}

function isArrayItemLine(line: YamlLine): boolean {
  return line.startsWith('  - ')
}

function skipArrayItemLines(lines: YamlLine[], start: number): number {
  let next = start
  while (next < lines.length && isArrayItemLine(lines[next])) next++
  return next
}

function appendReplacement(lines: YamlLine[], replacement: ReplacementLine): void {
  if (replacement !== null) lines.push(replacement)
}

function hasMatchingKey(lines: YamlLine[], key: FrontmatterKey): boolean {
  return lines.some(line => lineMatchesKey(line, key))
}

function frontmatterLines(fm: MarkdownContent, lineEnding: LineEnding): YamlLine[] {
  return fm === '' ? [] : fm.split(lineEnding)
}

function formatFrontmatterBlock(lines: YamlLine[], lineEnding: LineEnding, rest: MarkdownContent): MarkdownContent {
  return `---${lineEnding}${lines.join(lineEnding)}${lineEnding}---${rest}`
}

function processKeyInLines(lines: YamlLine[], key: FrontmatterKey, replacement: ReplacementLine): YamlLine[] {
  const newLines: YamlLine[] = []
  let i = 0
  while (i < lines.length) {
    if (lineMatchesKey(lines[i], key)) {
      i = skipArrayItemLines(lines, i + 1)
      appendReplacement(newLines, replacement)
      continue
    }
    newLines.push(lines[i])
    i++
  }
  return newLines
}

export function updateMockFrontmatter(path: VaultPath, key: FrontmatterKey, value: FrontmatterValue): MarkdownContent {
  const content = window.__mockContent?.[path] || ''
  const writeKey = canonicalWriteKey(key)
  const yamlKey = formatYamlKey(writeKey)
  const yamlValue = formatYamlValue(value)
  const isArray = Array.isArray(value)

  const parsed = parseFrontmatter(content)
  if (!parsed) {
    return `---\n${formatKeyValue(yamlKey, yamlValue, isArray)}\n---\n${content}`
  }

  const { fm, rest, lineEnding } = parsed
  const lines = frontmatterLines(fm, lineEnding)
  const replacement = formatKeyValue(yamlKey, yamlValue, isArray)

  if (hasMatchingKey(lines, key)) {
    const newLines = processKeyInLines(lines, key, replacement)
    return formatFrontmatterBlock(newLines, lineEnding, rest)
  }

  return formatFrontmatterBlock([...lines, replacement], lineEnding, rest)
}

export function deleteMockFrontmatterProperty(path: VaultPath, key: FrontmatterKey): MarkdownContent {
  const content = window.__mockContent?.[path] || ''
  const parsed = parseFrontmatter(content)
  if (!parsed) return content

  const { fm, rest, lineEnding } = parsed
  const newLines = processKeyInLines(frontmatterLines(fm, lineEnding), key, null)
  return formatFrontmatterBlock(newLines, lineEnding, rest)
}
