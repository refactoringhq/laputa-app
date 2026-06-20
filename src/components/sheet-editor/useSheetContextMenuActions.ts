import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  applySheetStructureAction,
  type SheetContextMenuState,
  type SheetStructureAction,
} from '../../utils/sheetContextMenuState'
import {
  decreaseDecimalPlaces,
  increaseDecimalPlaces,
  selectedCellStyle,
  selectedRangeArea,
} from '../../utils/sheetSelection'
import { SHEET_INDEX } from '../../utils/sheetWorkbook'
import type { ScheduleSheetSerializeOptions, SheetWorkbookState } from './sheetEditorTypes'

interface UseSheetContextMenuActionsOptions {
  refreshWorkbook: () => void
  scheduleSelectionChromePatch: () => void
  scheduleSerialize: (options?: ScheduleSheetSerializeOptions) => void
  setSheetContextMenu: Dispatch<SetStateAction<SheetContextMenuState | null>>
  workbookRef: MutableRefObject<SheetWorkbookState | null>
}

export function useSheetContextMenuActions({
  refreshWorkbook,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  setSheetContextMenu,
  workbookRef,
}: UseSheetContextMenuActionsOptions) {
  const applySelectedStyle = useCallback((stylePath: string, value: string) => {
    const current = workbookRef.current
    if (!current) return
    current.model.updateRangeStyle(selectedRangeArea(current.model), stylePath, value)
    refreshWorkbook()
    scheduleSerialize({ bodyRows: 'none' })
    setSheetContextMenu(null)
  }, [refreshWorkbook, scheduleSerialize, setSheetContextMenu, workbookRef])

  const finishContextWorkbookMutation = useCallback((serializeOptions: ScheduleSheetSerializeOptions = {}) => {
    refreshWorkbook()
    scheduleSelectionChromePatch()
    scheduleSerialize(serializeOptions)
    setSheetContextMenu(null)
  }, [refreshWorkbook, scheduleSelectionChromePatch, scheduleSerialize, setSheetContextMenu])

  const handleContextStructureAction = useCallback((action: SheetStructureAction) => {
    const current = workbookRef.current
    if (!current) return

    applySheetStructureAction(current.model, action)
    finishContextWorkbookMutation()
  }, [finishContextWorkbookMutation, workbookRef])

  const handleContextFreezeRows = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    const { sheet, row } = current.model.getSelectedView()
    current.model.setFrozenRowsCount(sheet, row)
    finishContextWorkbookMutation({ bodyRows: 'none' })
  }, [finishContextWorkbookMutation, workbookRef])

  const handleContextFreezeColumns = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    const { sheet, column } = current.model.getSelectedView()
    current.model.setFrozenColumnsCount(sheet, column)
    finishContextWorkbookMutation({ bodyRows: 'none' })
  }, [finishContextWorkbookMutation, workbookRef])

  const handleContextClearFormatting = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    const area = selectedRangeArea(current.model)
    current.model.rangeClearFormatting(
      area.sheet,
      area.row,
      area.column,
      area.row + area.height - 1,
      area.column + area.width - 1,
    )
    finishContextWorkbookMutation({ bodyRows: 'none' })
  }, [finishContextWorkbookMutation, workbookRef])

  const handleContextToggleWrapText = useCallback(() => {
    const current = workbookRef.current
    if (!current) return
    const shouldWrap = selectedCellStyle(current.model).alignment?.wrap_text !== true
    current.model.updateRangeStyle(selectedRangeArea(current.model), 'alignment.wrap_text', String(shouldWrap))
    finishContextWorkbookMutation({ bodyRows: 'none' })
  }, [finishContextWorkbookMutation, workbookRef])

  return {
    handleContextBold: () => {
      const current = workbookRef.current
      if (!current) return
      applySelectedStyle('font.b', String(!selectedCellStyle(current.model).font.b))
    },
    handleContextClearFormatting,
    handleContextDecreaseDecimals: () => {
      const current = workbookRef.current
      if (!current) return
      applySelectedStyle('num_fmt', decreaseDecimalPlaces(selectedCellStyle(current.model).num_fmt))
    },
    handleContextFreezeColumns,
    handleContextFreezeRows,
    handleContextIncreaseDecimals: () => {
      const current = workbookRef.current
      if (!current) return
      applySelectedStyle('num_fmt', increaseDecimalPlaces(selectedCellStyle(current.model).num_fmt))
    },
    handleContextItalic: () => {
      const current = workbookRef.current
      if (!current) return
      applySelectedStyle('font.i', String(!selectedCellStyle(current.model).font.i))
    },
    handleContextNumberFormat: (format: string) => applySelectedStyle('num_fmt', format),
    handleContextStructureAction,
    handleContextToggleWrapText,
    handleContextUnfreezeColumns: () => {
      const current = workbookRef.current
      if (!current) return
      current.model.setFrozenColumnsCount(SHEET_INDEX, 0)
      finishContextWorkbookMutation({ bodyRows: 'none' })
    },
    handleContextUnfreezeRows: () => {
      const current = workbookRef.current
      if (!current) return
      current.model.setFrozenRowsCount(SHEET_INDEX, 0)
      finishContextWorkbookMutation({ bodyRows: 'none' })
    },
  }
}

