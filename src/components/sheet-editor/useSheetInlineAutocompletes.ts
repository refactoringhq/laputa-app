import { useCallback } from 'react'
import { visibleFormulaInput } from './sheetEditorHelpers'
import { useSheetFormulaAutocomplete } from './useSheetFormulaAutocomplete'
import { useSheetWikilinkAutocomplete } from './useSheetWikilinkAutocomplete'
import type { UseSheetInlineAutocompletesOptions } from './sheetInlineAutocompleteTypes'

export function useSheetInlineAutocompletes(options: UseSheetInlineAutocompletesOptions) {
  const {
    sheetElementRef,
  } = options
  const {
    applyAutocompleteSuggestion,
    handleFormulaKeyDown,
    updateFormulaAutocomplete,
  } = useSheetFormulaAutocomplete(options)
  const {
    handleWikilinkKeyDown,
    updateWikilinkAutocomplete,
  } = useSheetWikilinkAutocomplete(options)
  const updateSheetInlineAutocompletes = useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (updateWikilinkAutocomplete(input)) return
    updateFormulaAutocomplete(input?.value.trimStart().startsWith('=') ? input : visibleFormulaInput(sheetElementRef.current))
  }, [sheetElementRef, updateFormulaAutocomplete, updateWikilinkAutocomplete])

  return {
    applyAutocompleteSuggestion,
    handleFormulaKeyDown,
    handleWikilinkKeyDown,
    updateSheetInlineAutocompletes,
  }
}

