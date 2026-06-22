import { memo } from 'react'
import type {
  MutableRefObject,
} from 'react'
import { IronCalc } from '@ironcalc/workbook'
import { translate, type AppLocale } from '../lib/i18n'
import { SheetContextMenu } from './SheetContextMenu'
import { SheetFormulaAutocompleteMenu } from './SheetFormulaAutocompleteMenu'
import { WikilinkSuggestionMenu } from './WikilinkSuggestionMenu'
import { useSheetEditorController } from './sheet-editor/useSheetEditorController'
import type { VaultEntry } from '../types'
import './SheetEditor.css'

const EMPTY_VAULT_ENTRIES: VaultEntry[] = []

interface SheetEditorProps {
  content: string
  entries?: VaultEntry[]
  locale?: AppLocale
  path: string
  onContentChange: (path: string, content: string) => void
  onNavigateWikilink?: (target: string) => void
  flushContentRef?: MutableRefObject<((path: string) => void) | null>
  sourceEntry?: VaultEntry | null
  vaultPath?: string
}

const MemoizedIronCalc = memo(IronCalc)

function workbookEditorClassName(sheetKeyboardActive: boolean) {
  const focusClassName = sheetKeyboardActive ? 'sheet-editor--keyboard-active' : 'sheet-editor--passive'
  return `sheet-editor sheet-editor--workbook sheet-editor--single-sheet ${focusClassName}`
}

export function SheetEditor({
  content,
  entries = EMPTY_VAULT_ENTRIES,
  locale = 'en',
  path,
  onContentChange,
  onNavigateWikilink,
  flushContentRef,
  sourceEntry = null,
  vaultPath = '',
}: SheetEditorProps) {
  const {
    applyAutocompleteSuggestion,
    error,
    formulaAutocomplete,
    handleContextBold,
    handleContextClearFormatting,
    handleContextDecreaseDecimals,
    handleContextFreezeColumns,
    handleContextFreezeRows,
    handleContextIncreaseDecimals,
    handleContextItalic,
    handleContextNumberFormat,
    handleContextStructureAction,
    handleContextToggleWrapText,
    handleContextUnfreezeColumns,
    handleContextUnfreezeRows,
    interactionHandlers,
    selectFormulaAutocompleteIndex,
    setSheetContextMenu,
    sheetContextMenu,
    sheetElementRef,
    sheetKeyboardActive,
    wikilinkAutocomplete,
    workbook,
  } = useSheetEditorController({
    content,
    entries,
    flushContentRef,
    locale,
    onContentChange,
    onNavigateWikilink,
    path,
    sourceEntry,
    vaultPath,
  })

  if (error) {
    return (
      <div className="sheet-editor sheet-editor--status" data-testid="sheet-editor">
        {translate(locale, 'editor.sheet.unavailable', { error })}
      </div>
    )
  }

  if (!workbook) {
    return (
      <div className="sheet-editor sheet-editor--status" data-testid="sheet-editor">
        {translate(locale, 'editor.sheet.loading')}
      </div>
    )
  }

  return (
    <div
      ref={sheetElementRef}
      className={workbookEditorClassName(sheetKeyboardActive)}
      data-testid="sheet-editor"
      {...interactionHandlers}
    >
      <MemoizedIronCalc model={workbook.model} refreshId={workbook.refreshId} />
      {formulaAutocomplete && (
        <SheetFormulaAutocompleteMenu
          onApplySuggestion={applyAutocompleteSuggestion}
          onSelectIndex={selectFormulaAutocompleteIndex}
          state={formulaAutocomplete}
        />
      )}
      {wikilinkAutocomplete && (
        <div
          className="sheet-wikilink-autocomplete"
          data-testid="sheet-wikilink-autocomplete"
          style={{
            left: wikilinkAutocomplete.left,
            top: wikilinkAutocomplete.top,
            minWidth: wikilinkAutocomplete.width,
          }}
        >
          <WikilinkSuggestionMenu
            items={wikilinkAutocomplete.items}
            loadingState="loaded"
            selectedIndex={wikilinkAutocomplete.selectedIndex}
          />
        </div>
      )}
      {sheetContextMenu && (
        <SheetContextMenu
          locale={locale}
          onBold={handleContextBold}
          onClearFormatting={handleContextClearFormatting}
          onClose={() => setSheetContextMenu(null)}
          onDeleteColumn={() => handleContextStructureAction('deleteColumn')}
          onDeleteRow={() => handleContextStructureAction('deleteRow')}
          onDecreaseDecimals={handleContextDecreaseDecimals}
          onFreezeColumns={handleContextFreezeColumns}
          onFreezeRows={handleContextFreezeRows}
          onIncreaseDecimals={handleContextIncreaseDecimals}
          onInsertColumnLeft={() => handleContextStructureAction('insertColumnLeft')}
          onInsertColumnRight={() => handleContextStructureAction('insertColumnRight')}
          onInsertRowAbove={() => handleContextStructureAction('insertRowAbove')}
          onInsertRowBelow={() => handleContextStructureAction('insertRowBelow')}
          onItalic={handleContextItalic}
          onNumberFormat={handleContextNumberFormat}
          onToggleWrapText={handleContextToggleWrapText}
          onUnfreezeColumns={handleContextUnfreezeColumns}
          onUnfreezeRows={handleContextUnfreezeRows}
          state={sheetContextMenu}
        />
      )}
    </div>
  )
}
