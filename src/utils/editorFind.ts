export interface EditorFindOptions {
  caseSensitive: boolean
  regex: boolean
}

export interface EditorFindMatch {
  from: number
  text: string
  to: number
}

export interface EditorFindResult {
  error: string | null
  matches: EditorFindMatch[]
}

export interface EditorFindChange {
  from: number
  insert: string
  to: number
}

type CompiledPattern =
  | { error: string; pattern: null }
  | { error: null; pattern: RegExp | null }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compileFindPattern(
  query: string,
  options: EditorFindOptions,
  global: boolean,
): CompiledPattern {
  if (query.length === 0) return { error: null, pattern: null }

  const source = options.regex ? query : escapeRegExp(query)
  const flags = `${global ? 'g' : ''}${options.caseSensitive ? '' : 'i'}`

  try {
    return { error: null, pattern: new RegExp(source, flags) }
  } catch {
    return { error: 'Invalid regex', pattern: null }
  }
}

export function findEditorMatches(
  documentText: string,
  query: string,
  options: EditorFindOptions,
): EditorFindResult {
  const compiled = compileFindPattern(query, options, true)
  if (compiled.error) return { error: compiled.error, matches: [] }
  if (!compiled.pattern) return { error: null, matches: [] }

  const matches: EditorFindMatch[] = []
  let match: RegExpExecArray | null

  while ((match = compiled.pattern.exec(documentText)) !== null) {
    if (match[0].length === 0) {
      return { error: 'Regex must match text', matches: [] }
    }

    matches.push({
      from: match.index,
      text: match[0],
      to: match.index + match[0].length,
    })
  }

  return { error: null, matches }
}

export function clampEditorFindIndex(index: number, matchCount: number): number {
  if (matchCount <= 0) return 0
  return Math.min(Math.max(index, 0), matchCount - 1)
}

export function nextEditorFindIndex(
  index: number,
  matchCount: number,
  direction: 1 | -1,
): number {
  if (matchCount <= 0) return 0
  return (clampEditorFindIndex(index, matchCount) + direction + matchCount) % matchCount
}

export function replacementForEditorFindMatch(
  match: EditorFindMatch,
  query: string,
  replacement: string,
  options: EditorFindOptions,
): string {
  if (!options.regex) return replacement

  const compiled = compileFindPattern(query, options, false)
  if (!compiled.pattern) return replacement

  return match.text.replace(compiled.pattern, replacement)
}

export function buildEditorFindReplacementChange(
  match: EditorFindMatch,
  query: string,
  replacement: string,
  options: EditorFindOptions,
): EditorFindChange {
  return {
    from: match.from,
    insert: replacementForEditorFindMatch(match, query, replacement, options),
    to: match.to,
  }
}

export function buildEditorFindReplacementChanges(
  matches: readonly EditorFindMatch[],
  query: string,
  replacement: string,
  options: EditorFindOptions,
): EditorFindChange[] {
  return matches.map((match) => (
    buildEditorFindReplacementChange(match, query, replacement, options)
  ))
}
