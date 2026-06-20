import { memo, useCallback, useMemo, useRef, useState } from 'react'
import type {
  MutableRefObject,
} from 'react'
import { IronCalc } from '@ironcalc/workbook'
import { useSheetWikilinkNavigation } from '../hooks/useSheetWikilinkNavigation'
import { translate, type AppLocale } from '../lib/i18n'
import { buildTypeEntryMap } from '../utils/typeColors'
import { buildRawEditorBaseItems } from '../utils/rawEditorUtils'
import {
  SHEET_INDEX,
} from '../utils/sheetWorkbook'
import {
  type SheetContextMenuState,
} from '../utils/sheetContextMenuState'
import { SheetContextMenu } from './SheetContextMenu'
import { SheetFormulaAutocompleteMenu } from './SheetFormulaAutocompleteMenu'
import { WikilinkSuggestionMenu } from './WikilinkSuggestionMenu'
import {
  sheetCellFromPointer,
  type FormulaAutocompleteState,
  type SheetWikilinkAutocompleteState,
} from './sheet-editor/sheetEditorHelpers'
import { useSheetCellInputCommit } from './sheet-editor/useSheetCellInputCommit'
import { useSheetClipboardActions } from './sheet-editor/useSheetClipboardActions'
import { useSheetContextMenuActions } from './sheet-editor/useSheetContextMenuActions'
import { useSheetContextMenuCapture } from './sheet-editor/useSheetContextMenuCapture'
import { useSheetExternalFormulaResolution } from './sheet-editor/useSheetExternalFormulaResolution'
import { useSheetInputActivityHandlers } from './sheet-editor/useSheetInputActivityHandlers'
import { useSheetInlineAutocompletes } from './sheet-editor/useSheetInlineAutocompletes'
import { useSheetKeyboardFocus } from './sheet-editor/useSheetKeyboardFocus'
import { useSheetKeyboardHandlers } from './sheet-editor/useSheetKeyboardHandlers'
import { useSheetKeyboardReleaseOutside } from './sheet-editor/useSheetKeyboardReleaseOutside'
import { useSheetPointerCoordinatePatching } from './sheet-editor/useSheetPointerCoordinatePatching'
import { useSheetPointerHandlers } from './sheet-editor/useSheetPointerHandlers'
import { useSheetSelectionChrome } from './sheet-editor/useSheetSelectionChrome'
import { useSheetWorkbookController } from './sheet-editor/useSheetWorkbookController'
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
  const [formulaAutocomplete, setFormulaAutocomplete] = useState<FormulaAutocompleteState | null>(null)
  const [wikilinkAutocomplete, setWikilinkAutocomplete] = useState<SheetWikilinkAutocompleteState | null>(null)
  const [sheetContextMenu, setSheetContextMenu] = useState<SheetContextMenuState | null>(null)
  const formulaInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const wikilinkInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const pendingExternalFormulaCommitRef = useRef(0)
  const sheetElementRef = useRef<HTMLDivElement | null>(null)
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const wikilinkBaseItems = useMemo(() => buildRawEditorBaseItems(entries), [entries])

  const {
    buildLiveExternalFormulaContext,
    externalFormulaContextForBuild,
    nativeExternalFormulaInputsForBuild,
  } = useSheetExternalFormulaResolution({
    content,
    entries,
    path,
    sourceEntry,
  })

  const {
    cancelScheduledSerialize,
    error,
    refreshWorkbook,
    scheduleSerialize,
    serializeCurrentWorkbook,
    workbook,
    workbookRef,
  } = useSheetWorkbookController({
    content,
    externalFormulaContextForBuild,
    nativeExternalFormulaInputsForBuild,
    onContentChange,
    path,
    pendingExternalFormulaCommitRef,
  })

  const scheduleSelectionChromePatch = useSheetSelectionChrome({
    refreshWorkbook,
    sheetElementRef,
    workbook,
  })
  const sheetPointerActiveRef = useSheetPointerCoordinatePatching({ sheetElementRef })

  const {
    captureSheetKeyboard,
    releaseSheetKeyboard,
    restoreSheetKeyboardFocus,
    sheetFocusRequestRef,
    sheetKeyboardCapturedRef,
  } = useSheetKeyboardFocus({
    scheduleSelectionChromePatch,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
  })

  const {
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
  } = useSheetContextMenuActions({
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setSheetContextMenu,
    workbookRef,
  })

  const {
    commitExternalFormulaEditorInput,
    commitSelectedCellInput,
    flushCurrentSheetContent,
    writeCellInputAt,
  } = useSheetCellInputCommit({
    buildLiveExternalFormulaContext,
    cancelScheduledSerialize,
    flushContentRef,
    pendingExternalFormulaCommitRef,
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    serializeCurrentWorkbook,
    sheetElementRef,
    workbookRef,
  })

  const {
    handleCopyCapture,
    handleCutCapture,
    handlePasteCapture,
  } = useSheetClipboardActions({
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    workbookRef,
    writeCellInputAt,
  })

  const {
    applyAutocompleteSuggestion,
    handleFormulaKeyDown,
    handleWikilinkKeyDown,
    updateSheetInlineAutocompletes,
  } = useSheetInlineAutocompletes({
    commitSelectedCellInput,
    entries,
    formulaAutocomplete,
    formulaInputRef,
    locale,
    refreshWorkbook,
    scheduleSerialize,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
    sourceEntry,
    typeEntryMap,
    vaultPath,
    wikilinkAutocomplete,
    wikilinkBaseItems,
    wikilinkInputRef,
    workbookRef,
  })

  const {
    handleKeyDownCapture,
    handleSheetKeyDown,
  } = useSheetKeyboardHandlers({
    cancelScheduledSerialize,
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    handleFormulaKeyDown,
    handleWikilinkKeyDown,
    refreshWorkbook,
    releaseSheetKeyboard,
    restoreSheetKeyboardFocus,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    serializeCurrentWorkbook,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
    sheetKeyboardCapturedRef,
    workbookRef,
  })

  const {
    handleBlurCapture,
    handleInputCapture,
    handleKeyUpCapture,
  } = useSheetInputActivityHandlers({
    commitExternalFormulaEditorInput,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
    updateSheetInlineAutocompletes,
    workbookRef,
  })

  const handleContextMenuCapture = useSheetContextMenuCapture({
    captureSheetKeyboard,
    setSheetContextMenu,
    sheetElementRef,
    workbookRef,
  })

  useSheetKeyboardReleaseOutside({
    releaseSheetKeyboard,
    sheetElementRef,
  })

  const dismissSheetTransientUi = useCallback(() => {
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete(null)
    setSheetContextMenu(null)
  }, [])

  const handleSheetWikilinkPointerDown = useSheetWikilinkNavigation({
    cellFromPointer: sheetCellFromPointer,
    containerRef: sheetElementRef,
    dismissTransientUi: dismissSheetTransientUi,
    onNavigateWikilink,
    onBeforeNavigate: flushCurrentSheetContent,
    sheetIndex: SHEET_INDEX,
    workbookRef,
  })

  const {
    handlePointerDownCapture,
    handlePointerMoveCapture,
    handlePointerUpCapture,
  } = useSheetPointerHandlers({
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    handleSheetWikilinkPointerDown,
    scheduleSelectionChromePatch,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
    sheetFocusRequestRef,
    sheetKeyboardCapturedRef,
    sheetPointerActiveRef,
  })

  const interactionHandlers = useMemo(() => ({
    onBlurCapture: handleBlurCapture,
    onCopyCapture: handleCopyCapture,
    onCutCapture: handleCutCapture,
    onContextMenuCapture: handleContextMenuCapture,
    onInputCapture: handleInputCapture,
    onKeyDown: handleSheetKeyDown,
    onKeyDownCapture: handleKeyDownCapture,
    onKeyUpCapture: handleKeyUpCapture,
    onPasteCapture: handlePasteCapture,
    onPointerDownCapture: handlePointerDownCapture,
    onPointerMoveCapture: handlePointerMoveCapture,
    onPointerUpCapture: handlePointerUpCapture,
  }), [
    handleBlurCapture,
    handleCopyCapture,
    handleContextMenuCapture,
    handleCutCapture,
    handleInputCapture,
    handleKeyDownCapture,
    handleKeyUpCapture,
    handlePasteCapture,
    handlePointerDownCapture,
    handlePointerMoveCapture,
    handlePointerUpCapture,
    handleSheetKeyDown,
  ])

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
      className="sheet-editor sheet-editor--workbook sheet-editor--single-sheet"
      data-testid="sheet-editor"
      {...interactionHandlers}
    >
      <MemoizedIronCalc model={workbook.model} refreshId={workbook.refreshId} />
      {formulaAutocomplete && (
        <SheetFormulaAutocompleteMenu
          onApplySuggestion={applyAutocompleteSuggestion}
          onSelectIndex={(index) => {
            setFormulaAutocomplete((current) => {
              if (!current) return null
              return { ...current, selectedIndex: index }
            })
          }}
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
