import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { AppLocale } from '../../lib/i18n'
import type { buildRawEditorBaseItems } from '../../utils/rawEditorUtils'
import type { VaultEntry } from '../../types'
import type { FormulaAutocompleteState, SheetWikilinkAutocompleteState } from './sheetEditorHelpers'
import type { ScheduleSheetSerializeOptions, SheetWorkbookState } from './sheetEditorTypes'

export type RawEditorBaseItems = ReturnType<typeof buildRawEditorBaseItems>

export interface UseSheetInlineAutocompletesOptions {
  commitSelectedCellInput: (input: string, options?: { allowPendingExternal?: boolean }) => boolean
  entries: VaultEntry[]
  formulaAutocomplete: FormulaAutocompleteState | null
  formulaInputRef: MutableRefObject<HTMLInputElement | HTMLTextAreaElement | null>
  locale: AppLocale
  refreshWorkbook: () => void
  scheduleSerialize: (options?: ScheduleSheetSerializeOptions) => void
  setFormulaAutocomplete: Dispatch<SetStateAction<FormulaAutocompleteState | null>>
  setWikilinkAutocomplete: Dispatch<SetStateAction<SheetWikilinkAutocompleteState | null>>
  sheetElementRef: MutableRefObject<HTMLDivElement | null>
  sourceEntry: VaultEntry | null
  typeEntryMap: Record<string, VaultEntry>
  vaultPath: string
  wikilinkAutocomplete: SheetWikilinkAutocompleteState | null
  wikilinkBaseItems: RawEditorBaseItems
  wikilinkInputRef: MutableRefObject<HTMLInputElement | HTMLTextAreaElement | null>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

