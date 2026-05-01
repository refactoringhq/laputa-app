import type { FrontmatterValue } from '../components/Inspector'

type VaultPath = string
type MarkdownContent = string
type FrontmatterKey = string
type YamlKey = string
type YamlValue = string
type YamlLine = string
type ReplacementLine = string | null

function isTypeKey(key: FrontmatterKey): boolean {
  return key.trim().toLowerCase() === 'type'
}

function canonicalWriteKey(key: FrontmatterKey): FrontmatterKey {
  return isTypeKey(key) ? 'type' : key
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

function buildKeyPattern(key: FrontmatterKey): RegExp {
  const flags = isTypeKey(key) ? 'im' : 'm'
  return new RegExp(`^["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`, flags)
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

function processKeyInLines(lines: YamlLine[], keyPattern: RegExp, replacement: ReplacementLine): YamlLine[] {
  const newLines: YamlLine[] = []
  let i = 0
  while (i < lines.length) {
    if (keyPattern.test(lines[i])) {
      i++
      while (i < lines.length && lines[i].startsWith('  - ')) i++
      if (replacement !== null) newLines.push(replacement)
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
  const keyPattern = buildKeyPattern(key)

  if (keyPattern.test(fm)) {
    const newLines = processKeyInLines(fm.split('\n'), keyPattern, formatKeyValue(yamlKey, yamlValue, isArray))
    return `---\n${newLines.join('\n')}\n---${rest}`
  }

  return `---\n${fm}\n${formatKeyValue(yamlKey, yamlValue, isArray)}\n---${rest}`
}

export function deleteMockFrontmatterProperty(path: VaultPath, key: FrontmatterKey): MarkdownContent {
  const content = window.__mockContent?.[path] || ''
  const parsed = parseFrontmatter(content)
  if (!parsed) return content

  const { fm, rest } = parsed
  const keyPattern = buildKeyPattern(key)
  const newLines = processKeyInLines(fm.split('\n'), keyPattern, null)
  return `---\n${newLines.join('\n')}\n---${rest}`
}
