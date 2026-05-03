import safeRegex from 'safe-regex2'

const MAX_USER_REGEX_LENGTH = 256
const REGEX_REPEAT_LIMIT = 25
const RegexConstructor = RegExp

export type SafeRegexResult =
  | { ok: true; pattern: RegExp }
  | { ok: false; reason: 'invalid' | 'too_long' | 'unsafe' }

export function compileSafeUserRegex(source: string, flags = ''): SafeRegexResult {
  if (source.length > MAX_USER_REGEX_LENGTH) return { ok: false, reason: 'too_long' }

  try {
    const pattern = Reflect.construct(RegexConstructor, [source, flags]) as RegExp
    if (!safeRegex(source, { limit: REGEX_REPEAT_LIMIT })) return { ok: false, reason: 'unsafe' }
    return { ok: true, pattern }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
