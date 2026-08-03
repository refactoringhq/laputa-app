import { Button } from '@/components/ui/button'
import { translate, type AppLocale } from '../lib/i18n'
import type { SheetContextMenuState } from '../utils/sheetContextMenuState'

interface SheetContextMenuProps {
  locale: AppLocale
  state: SheetContextMenuState
  onBold: () => void
  onClearFormatting: () => void
  onClose: () => void
  onDeleteColumn: () => void
  onDeleteRow: () => void
  onDecreaseDecimals: () => void
  onFreezeColumns: () => void
  onFreezeRows: () => void
  onIncreaseDecimals: () => void
  onInsertColumnLeft: () => void
  onInsertColumnRight: () => void
  onInsertRowAbove: () => void
  onInsertRowBelow: () => void
  onItalic: () => void
  onNumberFormat(format: string): void
  onToggleWrapText: () => void
  onUnfreezeColumns: () => void
  onUnfreezeRows: () => void
}

function SheetContextMenuItem({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <Button
      className="sheet-context-menu__item"
      onClick={onClick}
      role="menuitem"
      size="sm"
      type="button"
      variant="ghost"
    >
      {children}
    </Button>
  )
}

export function SheetContextMenu(options: SheetContextMenuProps) {
  const { onClose, state } = options
  return (
    <div
      className="sheet-context-menu"
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      role="menu"
      style={{ left: state.left, top: state.top }}
    >
      <SheetStructureGroups options={options} />
      <SheetFormattingGroups options={options} />
    </div>
  )
}

function SheetStructureGroups({ options }: { options: SheetContextMenuProps }) {
  const { locale, state, onDeleteColumn, onDeleteRow, onFreezeColumns, onFreezeRows, onInsertColumnLeft, onInsertColumnRight, onInsertRowAbove, onInsertRowBelow, onUnfreezeColumns, onUnfreezeRows } = options
  return <>
    <div className="sheet-context-menu__group">
      <SheetContextMenuItem onClick={onInsertRowAbove}>{translate(locale, 'editor.sheet.context.insertRowAbove')}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onInsertRowBelow}>{translate(locale, 'editor.sheet.context.insertRowBelow')}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onInsertColumnLeft}>{translate(locale, 'editor.sheet.context.insertColumnLeft')}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onInsertColumnRight}>{translate(locale, 'editor.sheet.context.insertColumnRight')}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onDeleteRow}>{translate(locale, 'editor.sheet.context.deleteRow', { row: String(state.row) })}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onDeleteColumn}>{translate(locale, 'editor.sheet.context.deleteColumn', { column: state.columnName })}</SheetContextMenuItem>
    </div>
    <div className="sheet-context-menu__group">
      <SheetContextMenuItem onClick={onFreezeRows}>{translate(locale, 'editor.sheet.context.freezeRows', { row: String(state.row) })}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onFreezeColumns}>{translate(locale, 'editor.sheet.context.freezeColumns', { column: state.columnName })}</SheetContextMenuItem>
      {state.frozenRows > 0 && <SheetContextMenuItem onClick={onUnfreezeRows}>{translate(locale, 'editor.sheet.context.unfreezeRows')}</SheetContextMenuItem>}
      {state.frozenColumns > 0 && <SheetContextMenuItem onClick={onUnfreezeColumns}>{translate(locale, 'editor.sheet.context.unfreezeColumns')}</SheetContextMenuItem>}
    </div>
  </>
}

function SheetFormattingGroups({ options }: { options: SheetContextMenuProps }) {
  const { locale, state, onBold, onClearFormatting, onDecreaseDecimals, onIncreaseDecimals, onItalic, onNumberFormat, onToggleWrapText } = options
  const numberFormats = [
    ['general', 'editor.sheet.context.auto'],
    ['#,##0.00', 'editor.sheet.context.number'],
    ['0.00%', 'editor.sheet.context.percentage'],
    ['"$"#,##0.00', 'editor.sheet.context.currencyUsd'],
    ['"\u20ac"#,##0.00', 'editor.sheet.context.currencyEur'],
  ] as const
  return <>
    <div className="sheet-context-menu__group">
      {numberFormats.map(([format, key]) => (
        <SheetContextMenuItem key={format} onClick={() => {
          onNumberFormat(format)
        }}>{translate(locale, key)}</SheetContextMenuItem>
      ))}
    </div>
    <div className="sheet-context-menu__group">
      <SheetContextMenuItem onClick={onDecreaseDecimals}>{translate(locale, 'editor.sheet.context.decreaseDecimals')}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onIncreaseDecimals}>{translate(locale, 'editor.sheet.context.increaseDecimals')}</SheetContextMenuItem>
    </div>
    <div className="sheet-context-menu__group">
      <SheetContextMenuItem onClick={onBold}>{translate(locale, 'editor.sheet.context.bold')}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onItalic}>{translate(locale, 'editor.sheet.context.italic')}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onToggleWrapText}>{translate(locale, state.isWrapped ? 'editor.sheet.context.unwrapText' : 'editor.sheet.context.wrapText')}</SheetContextMenuItem>
      <SheetContextMenuItem onClick={onClearFormatting}>{translate(locale, 'editor.sheet.context.clearFormatting')}</SheetContextMenuItem>
    </div>
  </>
}
