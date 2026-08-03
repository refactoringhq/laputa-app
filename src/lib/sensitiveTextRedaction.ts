export const PATH_REDACTION = '[redacted-path]'
export const TOKEN_REDACTION = '[redacted-token]'

const LEADING_TOKEN_WRAPPERS = new Set(['"', "'", '`', '(', '[', '{'])
const SENSITIVE_KEYS = ['token', 'secret', 'password', 'authorization', 'cookie', 'session']
const TOKEN_PREFIXES = ['ghp_', 'gho_', 'ghr_', 'ghs_', 'ghu_', 'github_pat_', 'sk-', 'xoxa-', 'xoxb-', 'xoxp-', 'xoxr-', 'xoxs-']
const TRAILING_TOKEN_WRAPPERS = new Set(['"', "'", '`', ')', ']', '}', '.', ',', ';'])
const WHITESPACE = new Set([' ', '\t', '\n', '\r'])

interface RedactTextInput {
  redactTokens?: boolean
  text: string
}

interface RedactTokenInput {
  redactTokens: boolean
  token: string
}

interface TextValueInput {
  value: string
}

interface TokenInput {
  token: string
}

interface SegmentInput {
  segment?: string
}

interface TokenParts {
  core: string
  prefix: string
  suffix: string
}

export function redactPathText({ text }: RedactTextInput): string {
  return redactTextSegments({ text })
}

export function sanitizeDiagnosticText({ text }: RedactTextInput): string {
  return collapseWhitespace({ text: redactTextSegments({ text, redactTokens: true }) }).trim()
}

export function isSensitiveDiagnosticKey({ text }: RedactTextInput): boolean {
  const lowerText = text.toLowerCase()
  return SENSITIVE_KEYS.some((sensitiveKey) => lowerText.includes(sensitiveKey))
}

function redactTextSegments({ text, redactTokens = false }: RedactTextInput): string {
  let redacted = ''
  let token = ''
  for (const char of text) {
    if (WHITESPACE.has(char)) {
      redacted += redactToken({ token, redactTokens }) + char
      token = ''
    } else {
      token += char
    }
  }
  return redacted + redactToken({ token, redactTokens })
}

function redactToken({ token, redactTokens }: RedactTokenInput): string {
  if (!token) return token

  const parts = tokenParts({ token })
  if (isAbsolutePath({ value: parts.core })) return `${parts.prefix}${PATH_REDACTION}${parts.suffix}`
  if (redactTokens && isTokenLike({ value: parts.core })) return `${parts.prefix}${TOKEN_REDACTION}${parts.suffix}`
  return token
}

function tokenParts({ token }: TokenInput): TokenParts {
  const start = leadingWrapperEnd(token)
  const end = trailingWrapperStart(token, start)
  return {
    prefix: token.slice(0, start),
    core: token.slice(start, end),
    suffix: token.slice(end),
  }
}

function leadingWrapperEnd(token: string): number {
  let start = 0
  while (LEADING_TOKEN_WRAPPERS.has(token.at(start) ?? '')) start += 1
  return start
}

function trailingWrapperStart(token: string, minimum: number): number {
  let end = token.length
  while (end > minimum && TRAILING_TOKEN_WRAPPERS.has(token.at(end - 1) ?? '')) end -= 1
  return end
}

function isAbsolutePath({ value }: TextValueInput): boolean {
  return isUnixAbsolutePath({ value }) || isWindowsAbsolutePath({ value })
}

function isUnixAbsolutePath({ value }: TextValueInput): boolean {
  return value.startsWith('/') && value.split('/').filter(Boolean).length >= 2
}

function isWindowsAbsolutePath({ value }: TextValueInput): boolean {
  const segments = value.split('\\').filter(Boolean)
  return segments.length >= 3 && isWindowsDriveSegment({ segment: segments[0] })
}

function isWindowsDriveSegment({ segment }: SegmentInput): boolean {
  const letter = segment?.at(0)
  return segment?.length === 2
    && letter !== undefined
    && letter.toLowerCase() !== letter.toUpperCase()
    && segment.at(1) === ':'
}

function isTokenLike({ value }: TextValueInput): boolean {
  return TOKEN_PREFIXES.some((prefix) => value.startsWith(prefix))
}

function collapseWhitespace({ text }: RedactTextInput): string {
  let collapsed = ''
  let pendingWhitespace = false
  for (const char of text) {
    if (WHITESPACE.has(char)) {
      pendingWhitespace = true
    } else {
      if (pendingWhitespace && collapsed.length > 0) collapsed += ' '
      collapsed += char
      pendingWhitespace = false
    }
  }
  return collapsed
}
