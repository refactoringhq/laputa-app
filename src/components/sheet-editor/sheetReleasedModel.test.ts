import { describe, expect, it } from 'vitest'
import {
  isIronCalcWasmBridgeError,
  isReleasedWorkbookModelError,
} from './sheetReleasedModel'

describe('IronCalc released model errors', () => {
  it('classifies native null-pointer failures as recoverable wasm bridge errors', () => {
    const error = new Error('null pointer passed to rust')

    expect(isReleasedWorkbookModelError(error)).toBe(true)
    expect(isIronCalcWasmBridgeError(error)).toBe(true)
  })

  it('does not classify unrelated errors as wasm bridge failures', () => {
    expect(isIronCalcWasmBridgeError(new Error('Unexpected workbook error'))).toBe(false)
  })
})
