import { format } from 'date-fns'

export type TemplateContext = {
  type?: string | null
  now?: Date
}

const TOKEN_PATTERN = /\{\{(\w+)(?::([^}]+))?\}\}/g

const DEFAULT_PATTERNS: Record<string, string> = {
  date: 'yyyy-MM-dd',
  time: 'HH:mm',
}

const TOKEN_RESOLVERS = new Map<string, (arg: string | undefined, ctx: TemplateContext, now: Date) => string | null>([
  ['date', (arg, _ctx, now) => safeFormat(now, arg ?? DEFAULT_PATTERNS.date)],
  ['time', (arg, _ctx, now) => safeFormat(now, arg ?? DEFAULT_PATTERNS.time)],
  ['type', (_arg, ctx) => ctx.type ?? ''],
])

function resolveToken(name: string, arg: string | undefined, ctx: TemplateContext, now: Date): string | null {
  const resolver = TOKEN_RESOLVERS.get(name)
  return resolver ? resolver(arg, ctx, now) : null
}

function safeFormat(now: Date, pattern: string): string | null {
  try {
    return format(now, pattern)
  } catch {
    return null
  }
}

/** Resolve `{{var}}` / `{{var:fmt}}` tokens in `template` against `ctx`. Unknown or
 *  malformed tokens are left verbatim so typos stay visible and predictable. */
export function substituteTemplate(template: string, ctx: TemplateContext = {}): string {
  const now = ctx.now ?? new Date()
  return template.replace(TOKEN_PATTERN, (match, name: string, arg: string | undefined) => {
    const resolved = resolveToken(name, arg, ctx, now)
    return resolved === null ? match : resolved
  })
}
