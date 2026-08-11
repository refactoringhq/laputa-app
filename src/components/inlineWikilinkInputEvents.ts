import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export function collapseSelectionRange(nextSelectionIndex: number) {
  return {
    start: nextSelectionIndex,
    end: nextSelectionIndex,
  }
}

export function fullSelectionRange(value: string) {
  return {
    start: 0,
    end: value.length,
  }
}

export function isSelectAllShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
  return event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey)
}

export function isCommandBackspaceShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
  return event.key === 'Backspace' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
}

export function isCompositionKeyboardEvent(event: ReactKeyboardEvent<HTMLDivElement>, isComposing: boolean) {
  return isComposing || event.nativeEvent.isComposing || event.keyCode === 229
}

export function isLineBreakShortcut(event: ReactKeyboardEvent<HTMLDivElement>, isComposing: boolean) {
  return (
    event.key === 'Enter' &&
    (event.shiftKey || event.ctrlKey) &&
    !isComposing &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229
  )
}

export function isNativeCompositionBeforeInput(
  nativeEvent: InputEvent,
  isComposing: boolean,
  hasPendingCompositionInput: boolean,
  isSettlingComposition: boolean,
) {
  return (
    isComposing ||
    hasPendingCompositionInput ||
    nativeEvent.isComposing ||
    nativeEvent.inputType === 'insertCompositionText' ||
    (isSettlingComposition && nativeEvent.inputType === 'insertText' && typeof nativeEvent.data === 'string')
  )
}
