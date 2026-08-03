import { useCallback, useMemo, useState } from 'react'
import type { VaultEntry } from '../types'
import { buildInlineWikilinkSuggestions, type InlineWikilinkSuggestion } from './inlineWikilinkSuggestions'
import { replaceActiveWikilinkQuery } from './inlineWikilinkText'

interface UseInlineWikilinkSuggestionsStateArgs {
  activeQueryKey: string
  entries: VaultEntry[]
  query: string | null
  value: string
  selectionIndex: number
  onChange: (value: string) => void
  onSelectionIndexChange: (selectionIndex: number) => void
  focusSelectionAt: (selectionIndex: number) => void
}

function selectedIndexForQuery(
  queryKey: string,
  currentState: { queryKey: string; index: number },
  suggestionCount: number,
) {
  if (currentState.queryKey !== queryKey) return 0
  return Math.min(currentState.index, Math.max(suggestionCount - 1, 0))
}

function buildInitialSuggestionState(queryKey: string, direction: 1 | -1, suggestionCount: number) {
  return {
    queryKey,
    index: direction > 0 ? 0 : suggestionCount - 1,
  }
}

function buildCycledSuggestionState(
  currentIndex: number,
  queryKey: string,
  direction: 1 | -1,
  suggestionCount: number,
) {
  const nextIndex =
    direction > 0 ? (currentIndex + 1) % suggestionCount : currentIndex <= 0 ? suggestionCount - 1 : currentIndex - 1

  return { queryKey, index: nextIndex }
}

function replacementForSuggestion(
  suggestions: InlineWikilinkSuggestion[],
  index: number,
  value: string,
  selectionIndex: number,
) {
  const suggestion = suggestions.at(index)
  if (!suggestion) return null
  return replaceActiveWikilinkQuery(value, selectionIndex, suggestion.target)
}

export function useInlineWikilinkSuggestionsState(options: UseInlineWikilinkSuggestionsStateArgs) {
  const { activeQueryKey, entries, query, value, selectionIndex, onChange, onSelectionIndexChange, focusSelectionAt } =
    options
  const [suggestionState, setSuggestionState] = useState({
    queryKey: '',
    index: 0,
  })

  const suggestions = useMemo<InlineWikilinkSuggestion[]>(
    () => (query === null ? [] : buildInlineWikilinkSuggestions(entries, query)),
    [entries, query],
  )

  const selectedSuggestionIndex = selectedIndexForQuery(activeQueryKey, suggestionState, suggestions.length)

  const setSuggestionIndex = useCallback(
    (index: number) => {
    setSuggestionState({ queryKey: activeQueryKey, index })
    },
    [activeQueryKey],
    )

  const selectSuggestion = useCallback(
    (index: number) => {
      const replacement = replacementForSuggestion(suggestions, index, value, selectionIndex)
    if (!replacement) return

    onChange(replacement.value)
    onSelectionIndexChange(replacement.nextSelectionIndex)
    setSuggestionState({ queryKey: '', index: 0 })
    window.setTimeout(() => focusSelectionAt(replacement.nextSelectionIndex), 0)
    },
    [focusSelectionAt, onChange, onSelectionIndexChange, selectionIndex, suggestions, value],
  )

  const cycleSuggestions = useCallback(
    (direction: 1 | -1) => {
    if (suggestions.length === 0) return

    setSuggestionState((current) => {
      if (current.queryKey !== activeQueryKey) {
        return buildInitialSuggestionState(activeQueryKey, direction, suggestions.length)
      }

        return buildCycledSuggestionState(current.index, activeQueryKey, direction, suggestions.length)
    })
    },
    [activeQueryKey, suggestions.length],
  )

  return {
    suggestions,
    selectedSuggestionIndex,
    setSuggestionIndex,
    selectSuggestion,
    cycleSuggestions,
  }
}
