import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from 'react'

export function stopAutocompleteKey(event: ReactKeyboardEvent<HTMLDivElement>) {
  event.preventDefault()
  event.stopPropagation()
}

export function autocompleteKeyAction(key: string) {
  if (key === 'ArrowDown' || key === 'ArrowUp') return 'move'
  if (key === 'Enter' || key === 'Tab') return 'apply'
  if (key === 'Escape') return 'dismiss'
  return null
}

function moveByKey(key: string) {
  return key === 'ArrowDown' ? 1 : -1
}

function nextSelectedIndex(selectedIndex: number, itemCount: number, key: string) {
  return (selectedIndex + moveByKey(key) + itemCount) % itemCount
}

export function moveAutocompleteSelection<State extends { selectedIndex: number }>(
  setState: Dispatch<SetStateAction<State | null>>,
  key: string,
  itemCount: (state: State) => number,
) {
  setState((current) => {
    if (!current) return null
    const count = itemCount(current)
    return count === 0 ? current : { ...current, selectedIndex: nextSelectedIndex(current.selectedIndex, count, key) }
  })
}

