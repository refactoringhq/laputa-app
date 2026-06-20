import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

const SPREADSHEET_MODIFIED_SHORTCUT_KEYS = new Set(['b', 'c', 'i', 'u', 'v', 'x', 'y', 'z'])
const WORKBOOK_NAVIGATION_KEYS = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Backspace',
  'Delete',
  'End',
  'Enter',
  'F2',
  'Home',
  'PageDown',
  'PageUp',
  'Return',
  'Tab',
])

export function isSpreadsheetKey(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  const hasModifier = event.metaKey || event.ctrlKey
  return (hasModifier && SPREADSHEET_MODIFIED_SHORTCUT_KEYS.has(event.key.toLowerCase()))
    || (event.key.length === 1 && !hasModifier && !event.altKey)
    || WORKBOOK_NAVIGATION_KEYS.has(event.key)
}
