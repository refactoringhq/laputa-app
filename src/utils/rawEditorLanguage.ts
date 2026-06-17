export type RawEditorLanguageId =
  | 'javascript'
  | 'json'
  | 'jsx'
  | 'markdown'
  | 'plain'
  | 'python'
  | 'sql'
  | 'tsx'
  | 'typescript'
  | 'yaml'

const LANGUAGE_BY_EXTENSION = new Map<string, RawEditorLanguageId>([
  ['cjs', 'javascript'],
  ['cts', 'typescript'],
  ['js', 'javascript'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['jsx', 'jsx'],
  ['markdown', 'markdown'],
  ['md', 'markdown'],
  ['mjs', 'javascript'],
  ['mts', 'typescript'],
  ['py', 'python'],
  ['pyw', 'python'],
  ['sql', 'sql'],
  ['ts', 'typescript'],
  ['tsx', 'tsx'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
])

function filenameFromPath(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? ''
}

function extensionFromFilename(filename: string): string | null {
  const match = /\.([^.]+)$/u.exec(filename)
  return match?.[1]?.toLowerCase() ?? null
}

export function rawEditorLanguageIdForPath(path?: string | null): RawEditorLanguageId {
  if (!path) return 'plain'

  const extension = extensionFromFilename(filenameFromPath(path))
  if (!extension) return 'plain'

  return LANGUAGE_BY_EXTENSION.get(extension) ?? 'plain'
}
