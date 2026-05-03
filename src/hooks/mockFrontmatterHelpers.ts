import type { FrontmatterValue } from '../components/Inspector'
import { canonicalFrontmatterWriteKey, frontmatterKeysMatch } from '../utils/systemMetadata'

type VaultPath = string
type MarkdownContent = string
type FrontmatterKey = string
type YamlKey = string
type YamlValue = string
type YamlLine = string
type ReplacementLine = string | null

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

function parseFrontmatter(content: MarkdownContent): { fm: MarkdownContent; rest: MarkdownContent } | null {
  if (!content.startsWith('---\n')) return null
  const fmEnd = content.indexOf('\n---', 4)
  if (fmEnd === -1) return null
  return { fm: content.slice(4, fmEnd), rest: content.slice(fmEnd + 4) }
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

  const { fm, rest } = parsed
  const lines = fm.split('\n')
  const replacement = formatKeyValue(yamlKey, yamlValue, isArray)

  if (hasMatchingKey(lines, key)) {
    const newLines = processKeyInLines(lines, key, replacement)
    return `---\n${newLines.join('\n')}\n---${rest}`
  }

  return `---\n${fm}\n${replacement}\n---${rest}`
}

export function deleteMockFrontmatterProperty(path: VaultPath, key: FrontmatterKey): MarkdownContent {
  const content = window.__mockContent?.[path] || ''
  const parsed = parseFrontmatter(content)
  if (!parsed) return content

  const { fm, rest } = parsed
  const newLines = processKeyInLines(fm.split('\n'), key, null)
  return `---\n${newLines.join('\n')}\n---${rest}`
}
