import type { SheetFormulaAutocompleteMenuState } from '../SheetFormulaAutocompleteMenu'
import type { WikilinkSuggestionItem } from '../WikilinkSuggestionMenu'

export interface FormulaAutocompleteState extends SheetFormulaAutocompleteMenuState {
  tokenStart: number
  tokenEnd: number
}

export interface SheetWikilinkAutocompleteState {
  items: WikilinkSuggestionItem[]
  selectedIndex: number
  left: number
  top: number
  width: number
}

function wikilinkSuggestionKey(item: WikilinkSuggestionItem): string {
  return item.path ?? `${item.title}\n${item.noteType ?? ''}`
}

export function nextWikilinkAutocompleteState(
  previous: SheetWikilinkAutocompleteState | null,
  next: SheetWikilinkAutocompleteState,
): SheetWikilinkAutocompleteState {
  if (!previous) return next
  const previousSelected = previous.items[previous.selectedIndex]
  const previousSelectedKey = previousSelected ? wikilinkSuggestionKey(previousSelected) : null
  const matchingIndex = previousSelectedKey === null
    ? -1
    : next.items.findIndex((item) => wikilinkSuggestionKey(item) === previousSelectedKey)
  return {
    ...next,
    selectedIndex: matchingIndex >= 0
      ? matchingIndex
      : Math.min(previous.selectedIndex, Math.max(next.items.length - 1, 0)),
  }
}

export function nextFormulaAutocompleteState(
  previous: FormulaAutocompleteState | null,
  next: FormulaAutocompleteState,
): FormulaAutocompleteState {
  if (!previous) return next
  const previousSelected = previous.suggestions[previous.selectedIndex]
  const matchingIndex = previousSelected
    ? next.suggestions.findIndex((suggestion) => suggestion.name === previousSelected.name)
    : -1
  return {
    ...next,
    selectedIndex: matchingIndex >= 0
      ? matchingIndex
      : Math.min(previous.selectedIndex, Math.max(next.suggestions.length - 1, 0)),
  }
}
