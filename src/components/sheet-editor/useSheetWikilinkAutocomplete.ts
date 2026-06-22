import { useCallback } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { trackEvent } from '../../lib/telemetry'
import {
  extractWikilinkQuery,
  replaceActiveWikilinkQuery,
} from '../../utils/rawEditorUtils'
import { isExternalFormulaInput } from '../../utils/sheetExternalReferences'
import { selectedRangeArea } from '../../utils/sheetSelection'
import {
  applySheetWikilinkStyle,
  sheetWikilinkCanvasColor,
} from '../../utils/sheetWikilinkModelBridge'
import {
  dispatchSheetInput,
  formulaAutocompletePosition,
  formulaInputFromTarget,
  isActiveWikilinkQueryInsideFormulaString,
  isInsideFormulaStringLiteral,
  nextWikilinkAutocompleteState,
  setFormulaInputValue,
  sheetWikilinkAutocompleteItems,
  visibleSheetTextInput,
} from './sheetEditorHelpers'
import {
  autocompleteKeyAction,
  moveAutocompleteSelection,
  stopAutocompleteKey,
} from './sheetAutocompleteKeyActions'
import type { UseSheetInlineAutocompletesOptions } from './sheetInlineAutocompleteTypes'

function useWikilinkTarget({
  commitSelectedCellInput,
  entries,
  refreshWorkbook,
  scheduleSerialize,
  setFormulaAutocomplete,
  setWikilinkAutocomplete,
  sourceEntry,
  wikilinkInputRef,
  workbookRef,
}: UseSheetInlineAutocompletesOptions) {
  return useCallback((target: string) => {
    const input = wikilinkInputRef.current
    if (!input) return

    const cursor = input.selectionStart ?? input.value.length
    const isFormulaInput = input.value.trimStart().startsWith('=')
    const replacement = replaceActiveWikilinkQuery(input.value, cursor, target)
    if (!replacement) return

    setFormulaInputValue(input, replacement.text)
    input.setSelectionRange(replacement.cursor, replacement.cursor)
    dispatchSheetInput(input)
    trackEvent('wikilink_inserted')
    input.focus()
    setWikilinkAutocomplete(null)
    setFormulaAutocomplete(null)

    const current = workbookRef.current
    if (current && !isFormulaInput) {
      commitSelectedCellInput(replacement.text)
      applySheetWikilinkStyle(current.model, selectedRangeArea(current.model), sheetWikilinkCanvasColor(replacement.text, entries, sourceEntry))
      refreshWorkbook()
    } else if (current && isExternalFormulaInput(replacement.text)) {
      commitSelectedCellInput(replacement.text, { allowPendingExternal: true })
    }
    scheduleSerialize({ bodyRows: 'none' })
  }, [
    commitSelectedCellInput,
    entries,
    refreshWorkbook,
    scheduleSerialize,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sourceEntry,
    wikilinkInputRef,
    workbookRef,
  ])
}

function useWikilinkUpdater(
  options: UseSheetInlineAutocompletesOptions,
  applyWikilinkAutocompleteTarget: (target: string) => void,
) {
  const {
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
    sourceEntry,
    typeEntryMap,
    vaultPath,
    wikilinkBaseItems,
    wikilinkInputRef,
  } = options

  return useCallback((input: HTMLInputElement | HTMLTextAreaElement | null) => {
    const container = sheetElementRef.current
    if (!input || !container) {
      wikilinkInputRef.current = null
      setWikilinkAutocomplete(null)
      return false
    }

    const cursor = input.selectionStart ?? input.value.length
    if (isInsideFormulaStringLiteral(input.value, cursor) || isActiveWikilinkQueryInsideFormulaString(input.value, cursor)) {
      wikilinkInputRef.current = null
      setWikilinkAutocomplete(null)
      return false
    }

    const query = extractWikilinkQuery(input.value, cursor)
    if (query === null) {
      wikilinkInputRef.current = input
      setWikilinkAutocomplete(null)
      return false
    }

    wikilinkInputRef.current = input
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete((current) => nextWikilinkAutocompleteState(current, {
      items: sheetWikilinkAutocompleteItems({
        baseItems: wikilinkBaseItems,
        insertWikilink: applyWikilinkAutocompleteTarget,
        query,
        sourceEntry: sourceEntry ?? undefined,
        typeEntryMap,
        vaultPath,
      }),
      selectedIndex: 0,
      ...formulaAutocompletePosition(input, container, cursor),
    }))
    return true
  }, [
    applyWikilinkAutocompleteTarget,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
    sourceEntry,
    typeEntryMap,
    vaultPath,
    wikilinkBaseItems,
    wikilinkInputRef,
  ])
}

function useWikilinkKeys({
  setWikilinkAutocomplete,
  sheetElementRef,
  wikilinkAutocomplete,
  wikilinkInputRef,
}: UseSheetInlineAutocompletesOptions) {
  return useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!wikilinkAutocomplete) return

    const input = formulaInputFromTarget(event.target) ?? visibleSheetTextInput(sheetElementRef.current)
    if (!input || input !== wikilinkInputRef.current) return

    const action = autocompleteKeyAction(event.key)
    if (!action) return

    stopAutocompleteKey(event)
    if (action === 'move') {
      moveAutocompleteSelection(setWikilinkAutocomplete, event.key, (state) => state.items.length)
    } else if (action === 'apply') {
      wikilinkAutocomplete.items[wikilinkAutocomplete.selectedIndex]?.onItemClick()
    } else {
      setWikilinkAutocomplete(null)
    }
  }, [setWikilinkAutocomplete, sheetElementRef, wikilinkAutocomplete, wikilinkInputRef])
}

export function useSheetWikilinkAutocomplete(options: UseSheetInlineAutocompletesOptions) {
  const applyWikilinkAutocompleteTarget = useWikilinkTarget(options)
  return {
    handleWikilinkKeyDown: useWikilinkKeys(options),
    updateWikilinkAutocomplete: useWikilinkUpdater(options, applyWikilinkAutocompleteTarget),
  }
}
