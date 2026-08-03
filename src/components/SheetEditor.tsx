import { Component, memo } from 'react'
import type { ErrorInfo, MutableRefObject, ReactNode } from 'react'
import { IronCalc } from '@ironcalc/workbook'
import { translate, type AppLocale } from '../lib/i18n'
import { SheetContextMenu } from './SheetContextMenu'
import { SheetFormulaAutocompleteMenu } from './SheetFormulaAutocompleteMenu'
import { WikilinkSuggestionMenu } from './WikilinkSuggestionMenu'
import { useSheetEditorController } from './sheet-editor/useSheetEditorController'
import { isIronCalcWasmBridgeError } from './sheet-editor/sheetReleasedModel'
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

interface SheetWorkbookBoundaryProps {
  children: ReactNode
  locale: AppLocale
}

interface SheetWorkbookBoundaryState {
  error: unknown
}

function workbookEditorClassName(sheetKeyboardActive: boolean) {
  const focusClassName = sheetKeyboardActive ? 'sheet-editor--keyboard-active' : 'sheet-editor--passive'
  return `sheet-editor sheet-editor--workbook sheet-editor--single-sheet ${focusClassName}`
}

function sheetErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function SheetUnavailableStatus({ error, locale }: { error: string; locale: AppLocale }) {
  return (
    <div className="sheet-editor sheet-editor--status" data-testid="sheet-editor">
      {translate(locale, 'editor.sheet.unavailable', { error })}
    </div>
  )
}

class SheetWorkbookBoundary extends Component<SheetWorkbookBoundaryProps, SheetWorkbookBoundaryState> {
  state: SheetWorkbookBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): SheetWorkbookBoundaryState {
    return { error }
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    if (!isIronCalcWasmBridgeError(error)) return

    console.warn('[sheet-editor] Recovered IronCalc WASM bridge render failure:', error, errorInfo.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (error) {
      if (!isIronCalcWasmBridgeError(error)) throw error
      return <SheetUnavailableStatus error={sheetErrorMessage(error)} locale={this.props.locale} />
    }

    return this.props.children
  }
}

type SheetEditorControllerState = ReturnType<typeof useSheetEditorController>

function SheetFormulaAutocompleteOverlay({ controller }: { controller: SheetEditorControllerState }) {
  const { applyAutocompleteSuggestion, formulaAutocomplete, selectFormulaAutocompleteIndex } = controller
  if (!formulaAutocomplete) return null

  return (
    <SheetFormulaAutocompleteMenu
      onApplySuggestion={applyAutocompleteSuggestion}
      onSelectIndex={selectFormulaAutocompleteIndex}
      state={formulaAutocomplete}
    />
  )
}

function SheetWikilinkAutocompleteOverlay({
  wikilinkAutocomplete,
}: {
  wikilinkAutocomplete: SheetEditorControllerState['wikilinkAutocomplete']
}) {
  if (!wikilinkAutocomplete) return null

  return (
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
  )
}

function SheetContextMenuOverlay({
  controller,
  locale,
}: {
  controller: SheetEditorControllerState
  locale: AppLocale
}) {
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
        setSheetContextMenu,
        sheetContextMenu,
      } = controller
      if (!sheetContextMenu) return null

      return (
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
      )
    }

    function SheetWorkbookSurface({
      controller,
      locale,
      workbook,
    }: {
      controller: SheetEditorControllerState
      locale: AppLocale
      workbook: NonNullable<SheetEditorControllerState['workbook']>
    }) {
      const { interactionHandlers, sheetElementRef, sheetKeyboardActive, wikilinkAutocomplete } = controller

      return (
        <div
          ref={sheetElementRef}
          className={workbookEditorClassName(sheetKeyboardActive)}
          data-testid="sheet-editor"
          {...interactionHandlers}
        >
          <MemoizedIronCalc model={workbook.model} refreshId={workbook.refreshId} />
          <SheetFormulaAutocompleteOverlay controller={controller} />
          <SheetWikilinkAutocompleteOverlay wikilinkAutocomplete={wikilinkAutocomplete} />
          <SheetContextMenuOverlay controller={controller} locale={locale} />
        </div>
      )
    }

    export function SheetEditor(options: SheetEditorProps) {
      const {
      content,
      entries = EMPTY_VAULT_ENTRIES,
      locale = 'en',
      path,
      onContentChange,
      onNavigateWikilink,
      flushContentRef,
      sourceEntry = null,
      vaultPath = '',
  } = options
  const controller = useSheetEditorController({
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
  const { error, workbook } = controller

  if (error) {
    return <SheetUnavailableStatus error={error} locale={locale} />
  }

  if (!workbook) {
    return (
      <div className="sheet-editor sheet-editor--status" data-testid="sheet-editor">
        {translate(locale, 'editor.sheet.loading')}
      </div>
    )
  }

  return (
    <SheetWorkbookBoundary key={`${workbook.path}:${workbook.generation}`} locale={locale}>
      <SheetWorkbookSurface controller={controller} locale={locale} workbook={workbook} />
    </SheetWorkbookBoundary>
  )
}
