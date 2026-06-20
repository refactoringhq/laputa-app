import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export function isPlainEnterKey(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  return (
    (event.key === 'Enter' || event.key === 'Return')
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
  )
}

export function isPlainCellClearKey(event: ReactKeyboardEvent<HTMLDivElement>): boolean {
  return (
    (event.key === 'Backspace' || event.key === 'Delete')
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
  )
}
