import { canonicalKnownCodeBlockLanguage } from './codeBlockLanguageCatalog'

type UnknownRecord = Record<string, unknown>
type LanguageDetector = (source: string) => boolean

const PLAIN_TEXT_LANGUAGES = new Set(['', 'none', 'plain', 'plaintext', 'text', 'txt'])
const LANGUAGE_DETECTORS: Array<[string, LanguageDetector]> = [
  ['html', (source) => /^\s*<[/!A-Za-z][\s\S]*>\s*$/u.test(source)],
  ['python', (source) => /^\s*(?:def|class)\s+\w+.*:\s*$/mu.test(source)],
  ['python', hasPythonImport],
  ['shellscript', (source) => /^\s*(?:#!.*\b(?:bash|sh|zsh)\b|(?:pnpm|npm|yarn|git|cd|echo|export)\b)/mu.test(source)],
  ['typescript', (source) => /\b(?:interface|type|enum|implements|readonly|namespace|declare)\b/u.test(source)],
  ['typescript', hasTypedCallableSignature],
  ['typescript', (source) => /:\s*(?:string|number|boolean|unknown|never|void|null|undefined|Record<|[A-Z]\w*(?:\[\])?)\b/u.test(source)],
  ['javascript', (source) => /\b(?:import|export|const|let|var|function|return)\b|=>/u.test(source)],
  ['sql', (source) => /^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b[\s\S]*\bFROM\b/iu.test(source)],
  ['yaml', (source) => /^\s*[\w-]+\s*:\s*[\s\S]*$/u.test(source)],
]

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textFromInlineContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content.map((item) => {
    if (typeof item === 'string') return item
    if (!isRecord(item)) return ''
    if (typeof item.text === 'string') return item.text
    return textFromInlineContent(item.content)
  }).join('')
}

function readLanguage(props: unknown): string {
  if (!isRecord(props) || typeof props.language !== 'string') return ''
  return props.language.trim()
}

function isPlainTextLanguage(language: string): boolean {
  return PLAIN_TEXT_LANGUAGES.has(language)
}

function isJson(source: string): boolean {
  if (!/^[{[]/u.test(source)) return false

  try {
    JSON.parse(source)
    return true
  } catch {
    return false
  }
}

function hasPythonImport(source: string): boolean {
  return source.split(/\r?\n/).some((line) => {
    const trimmed = line.trimStart()
    return trimmed.startsWith('import ') || (trimmed.startsWith('from ') && trimmed.includes(' import '))
  })
}

function hasTypedCallableSignature(source: string): boolean {
  return source.split(/\r?\n/).some((line) => {
    const trimmed = line.trim()
    const startsWithCallableKeyword = ['const ', 'let ', 'var ', 'function ']
      .some((keyword) => trimmed.startsWith(keyword))
    if (!startsWithCallableKeyword) return false

    const paramsStart = trimmed.indexOf('(')
    const paramsEnd = trimmed.indexOf(')', paramsStart + 1)
    if (paramsStart < 0 || paramsEnd < paramsStart) return false
    return trimmed.slice(paramsStart + 1, paramsEnd).includes(':')
  })
}

export function inferCodeBlockLanguage(source: string): string | null {
  const trimmed = source.trim()
  if (!trimmed) return null
  if (isJson(trimmed)) return 'json'
  return LANGUAGE_DETECTORS.find(([, detects]) => detects(trimmed))?.[0] ?? null
}

function inferChildren(children: unknown): unknown {
  return Array.isArray(children) ? children.map(inferBlock) : children
}

function withInferredChildren(block: UnknownRecord, children: unknown): UnknownRecord {
  return children === block.children ? block : { ...block, children }
}

function withInferredLanguage(block: UnknownRecord, children: unknown, language: string): UnknownRecord {
  const props = isRecord(block.props) ? block.props : {}
  return {
    ...block,
    children,
    props: {
      ...props,
      language,
    },
  }
}

function shouldCanonicalizeCodeBlockLanguage(
  block: UnknownRecord,
  canonicalLanguage: string | null,
  rawLanguage: string,
): canonicalLanguage is string {
  return block.type === 'codeBlock' && Boolean(canonicalLanguage) && canonicalLanguage !== rawLanguage
}

function shouldInferCodeBlockLanguage(block: UnknownRecord, language: string): boolean {
  return block.type === 'codeBlock' && isPlainTextLanguage(language)
}

function inferBlockLanguage(block: UnknownRecord): UnknownRecord {
  const children = inferChildren(block.children)
  const rawLanguage = readLanguage(block.props)
  const language = rawLanguage.toLowerCase()
  const canonicalLanguage = canonicalKnownCodeBlockLanguage(rawLanguage)

  if (shouldCanonicalizeCodeBlockLanguage(block, canonicalLanguage, rawLanguage)) {
    return withInferredLanguage(block, children, canonicalLanguage)
  }

  if (!shouldInferCodeBlockLanguage(block, language)) return withInferredChildren(block, children)

  const inferred = inferCodeBlockLanguage(textFromInlineContent(block.content))
  if (!inferred) return withInferredChildren(block, children)

  return withInferredLanguage(block, children, inferred)
}

function inferBlock(block: unknown): unknown {
  return isRecord(block) ? inferBlockLanguage(block) : block
}

export function inferCodeBlockLanguages(blocks: unknown[]): unknown[] {
  return blocks.map(inferBlock)
}
