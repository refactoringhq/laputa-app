import { useCallback } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { trackSheetFormulaAutocompleteUsed } from '../../lib/productAnalytics'
import {
  applyFormulaSuggestion,
  matchFormulaAutocomplete,
  type SheetFormulaSuggestion,
} from '../../utils/sheetFormulaAutocomplete'
import { dirtyRowsForSelectedRange } from '../../utils/sheetSelection'
import {
  dispatchFormulaInput,
  formulaAutocompletePosition,
  formulaInputFromTarget,
  nextFormulaAutocompleteState,
  setFormulaInputValue,
  visibleFormulaInput,
} from './sheetEditorHelpers'
import {
  autocompleteKeyAction,
  moveAutocompleteSelection,
  stopAutocompleteKey,
} from './sheetAutocompleteKeyActions'
import type { UseSheetInlineAutocompletesOptions } from './sheetInlineAutocompleteTypes'

function useFormulaUpdater({
  formulaInputRef,
  locale,
  setFormulaAutocomplete,
  sheetElementRef,
}: UseSheetInlineAutocompletesOptions) {
  return useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    const container = sheetElementRef.current
    if (!input || !container) {
      formulaInputRef.current = null
      setFormulaAutocomplete(null)
      return
    }

    const cursor = input.selectionStart ?? input.value.length
    const match = matchFormulaAutocomplete(input.value, cursor, locale)
    if (!match) {
      formulaInputRef.current = input
      setFormulaAutocomplete(null)
      return
    }

    formulaInputRef.current = input
    setFormulaAutocomplete((current) => nextFormulaAutocompleteState(current, {
      suggestions: match.suggestions,
      selectedIndex: 0,
      tokenStart: match.tokenStart,
      tokenEnd: match.tokenEnd,
      ...formulaAutocompletePosition(input, container, cursor),
    }))
  }, [formulaInputRef, locale, setFormulaAutocomplete, sheetElementRef])
}

function useFormulaSuggestion({
  formulaAutocomplete,
  formulaInputRef,
  scheduleSerialize,
  setFormulaAutocomplete,
  workbookRef,
}: UseSheetInlineAutocompletesOptions) {
  return useCallback((suggestion: SheetFormulaSuggestion) => {
    const input = formulaInputRef.current
    if (!input || !formulaAutocomplete) return

    const applied = applyFormulaSuggestion(input.value, formulaAutocomplete.tokenStart, formulaAutocomplete.tokenEnd, suggestion)
    setFormulaInputValue(input, applied.value)
    input.setSelectionRange(applied.cursor, applied.cursor)
    dispatchFormulaInput(input)
    trackSheetFormulaAutocompleteUsed(suggestion.name)
    input.focus()
    setFormulaAutocomplete(null)
    const current = workbookRef.current
    scheduleSerialize({ bodyRows: current ? dirtyRowsForSelectedRange(current.model) : 'all' })
  }, [formulaAutocomplete, formulaInputRef, scheduleSerialize, setFormulaAutocomplete, workbookRef])
}

function useFormulaKeys(
  options: UseSheetInlineAutocompletesOptions,
  applyAutocompleteSuggestion: (suggestion: SheetFormulaSuggestion) => void,
) {
  const { formulaAutocomplete, formulaInputRef, setFormulaAutocomplete, sheetElementRef } = options

  return useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!formulaAutocomplete) return

    const input = formulaInputFromTarget(event.target) ?? visibleFormulaInput(sheetElementRef.current)
    if (!input || input !== formulaInputRef.current) return

    const action = autocompleteKeyAction(event.key)
    if (!action) return

    stopAutocompleteKey(event)
    if (action === 'move') {
      moveAutocompleteSelection(setFormulaAutocomplete, event.key, (state) => state.suggestions.length)
    } else if (action === 'apply') {
      const suggestion = formulaAutocomplete.suggestions[formulaAutocomplete.selectedIndex]
      if (suggestion) applyAutocompleteSuggestion(suggestion)
    } else {
      setFormulaAutocomplete(null)
    }
  }, [applyAutocompleteSuggestion, formulaAutocomplete, formulaInputRef, setFormulaAutocomplete, sheetElementRef])
}

export function useSheetFormulaAutocomplete(options: UseSheetInlineAutocompletesOptions) {
  const applyAutocompleteSuggestion = useFormulaSuggestion(options)
  return {
    applyAutocompleteSuggestion,
    handleFormulaKeyDown: useFormulaKeys(options, applyAutocompleteSuggestion),
    updateFormulaAutocomplete: useFormulaUpdater(options),
  }
}
