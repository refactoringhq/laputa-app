import type { Model } from '@ironcalc/workbook'
import type { SheetExternalFormulaInput } from '../../utils/sheetExternalFormulaWorker'
import type { SheetBodyRowsUpdate } from '../../utils/sheetSelection'

export interface SheetWorkbookState {
  externalFormulaInputs: Map<string, SheetExternalFormulaInput>
  generation: number
  model: Model
  path: string
  refreshId: number
}

export interface ScheduleSheetSerializeOptions {
  bodyRows?: SheetBodyRowsUpdate
  dirty?: boolean
}

