import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

const SERIALIZE_SHORTCUT_KEYS = new Set(['b', 'i', 'u', 'v', 'x', 'y', 'z'])
const SERIALIZE_DIRECT_KEYS = new Set(['Backspace', 'Delete', 'Enter'])

export function shouldScheduleSerializeForKey(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  const hasModifier = event.metaKey || event.ctrlKey
  return SERIALIZE_DIRECT_KEYS.has(event.key)
    || (hasModifier && SERIALIZE_SHORTCUT_KEYS.has(event.key.toLowerCase()))
    || (event.key.length === 1 && !hasModifier && !event.altKey)
}
