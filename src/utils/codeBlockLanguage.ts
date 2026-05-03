type UnknownRecord = Record<string, unknown>

const PLAIN_TEXT_LANGUAGES = new Set(['', 'none', 'plain', 'plaintext', 'text', 'txt'])
const LANGUAGE_PATTERNS: Array<[string, RegExp]> = [
  ['html', /^\s*<[/!A-Za-z][\s\S]*>\s*$/u],
  ['python', /^\s*(?:def|class)\s+\w+.*:\s*$/mu],
  ['python', /^\s*(?:from\s+\w+(?:\.\w+)*\s+import|import\s+\w+)/mu],
  ['shellscript', /^\s*(?:#!.*\b(?:bash|sh|zsh)\b|(?:pnpm|npm|yarn|git|cd|echo|export)\b)/mu],
  ['typescript', /\b(?:interface|type|enum|implements|readonly|namespace|declare)\b/u],
  ['typescript', /\b(?:const|let|var|function)\s+\w+\s*(?:<[^>]+>)?\([^)]*:\s*[^)]*\)/u],
  ['typescript', /:\s*(?:string|number|boolean|unknown|never|void|null|undefined|Record<|[A-Z]\w*(?:\[\])?)\b/u],
  ['javascript', /\b(?:import|export|const|let|var|function|return)\b|=>/u],
  ['sql', /^\s*(?:SELECT|WITH|INSERT|UPDATE|DELETE)\b[\s\S]*\bFROM\b/iu],
  ['yaml', /^\s*[\w-]+\s*:\s*[\s\S]*$/u],
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

function normalizedLanguage(props: unknown): string {
  if (!isRecord(props) || typeof props.language !== 'string') return ''
  return props.language.trim().toLowerCase()
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

export function inferCodeBlockLanguage(source: string): string | null {
  const trimmed = source.trim()
  if (!trimmed) return null
  if (isJson(trimmed)) return 'json'
  return LANGUAGE_PATTERNS.find(([, pattern]) => pattern.test(trimmed))?.[0] ?? null
}

function inferChildren(children: unknown): unknown {
  return Array.isArray(children) ? children.map(inferBlock) : children
}

function withInferredChildren(block: UnknownRecord, children: unknown): UnknownRecord {
  return children === block.children ? block : { ...block, children }
}

function shouldInferLanguage(block: UnknownRecord): boolean {
  return block.type === 'codeBlock' && isPlainTextLanguage(normalizedLanguage(block.props))
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

function inferBlockLanguage(block: UnknownRecord): UnknownRecord {
  const children = inferChildren(block.children)

  if (!shouldInferLanguage(block)) return withInferredChildren(block, children)

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
