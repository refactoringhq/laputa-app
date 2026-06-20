import { describe, expect, it } from 'vitest'
import {
  applyFormulaSuggestion,
  matchFormulaAutocomplete,
  SHEET_FORMULA_SUGGESTIONS,
} from './sheetFormulaAutocomplete'
import { translate } from '../lib/i18n'

describe('sheetFormulaAutocomplete', () => {
  it('suggests function names from a formula prefix', () => {
    const match = matchFormulaAutocomplete('=SU', 3)

    expect(match?.prefix).toBe('SU')
    expect(match?.tokenStart).toBe(1)
    expect(match?.suggestions.map((suggestion) => suggestion.name)).toContain('SUM')
  })

  it('uses English formula metadata by default', () => {
    const match = matchFormulaAutocomplete('=SU', 3)
    const sum = match?.suggestions.find((suggestion) => suggestion.name === 'SUM')

    expect(sum?.category).toBe(translate('en', 'editor.sheet.formula.category.math'))
    expect(sum?.description).toBe(translate('en', 'editor.sheet.formula.description.sum'))
  })

  it('localizes formula metadata for the active locale', () => {
    const match = matchFormulaAutocomplete('=SU', 3, 'it-IT')
    const sum = match?.suggestions.find((suggestion) => suggestion.name === 'SUM')

    expect(sum?.category).toBe(translate('it-IT', 'editor.sheet.formula.category.math'))
    expect(sum?.description).toBe(translate('it-IT', 'editor.sheet.formula.description.sum'))
    expect(sum?.description).not.toBe(translate('en', 'editor.sheet.formula.description.sum'))
  })

  it('localizes generic descriptions with the translated category placeholder', () => {
    const match = matchFormulaAutocomplete('=AC', 3, 'it-IT')
    const acos = match?.suggestions.find((suggestion) => suggestion.name === 'ACOS')
    const category = translate('it-IT', 'editor.sheet.formula.category.math')

    expect(acos?.description).toBe(translate('it-IT', 'editor.sheet.formula.description.generic', { category }))
  })

  it('does not suggest while typing ordinary cell references', () => {
    expect(matchFormulaAutocomplete('=B', 2)).toBeNull()
  })

  it('suggests nested function names after formula separators', () => {
    const match = matchFormulaAutocomplete('=IF(A1>0,AV', 11)

    expect(match?.prefix).toBe('AV')
    expect(match?.suggestions[0]?.name).toBe('AVERAGE')
  })

  it('includes the full implemented IronCalc function catalog', () => {
    const names = SHEET_FORMULA_SUGGESTIONS.map((suggestion) => suggestion.name)

    expect(names).toHaveLength(195)
    expect(names).toEqual(expect.arrayContaining([
      'BITXOR',
      'CONCAT',
      'ERFC.PRECISE',
      'INDEX',
      'MATCH',
      'SUBTOTAL',
      'VLOOKUP',
      'XIRR',
      'XLOOKUP',
    ]))
  })

  it('suggests function names that contain digits', () => {
    const match = matchFormulaAutocomplete('=BIN2', 5)

    expect(match?.suggestions.map((suggestion) => suggestion.name)).toContain('BIN2DEC')
  })

  it('suggests function names that contain dots', () => {
    const match = matchFormulaAutocomplete('=ERFC.P', 7)

    expect(match?.suggestions.map((suggestion) => suggestion.name)).toContain('ERFC.PRECISE')
  })

  it('replaces only the active token and opens the function call', () => {
    const sum = SHEET_FORMULA_SUGGESTIONS.find((suggestion) => suggestion.name === 'SUM')
    expect(sum).toBeDefined()

    const applied = applyFormulaSuggestion('=SU', 1, 3, sum!)

    expect(applied.value).toBe('=SUM(')
    expect(applied.cursor).toBe(5)
  })

  it('does not insert a duplicate opening parenthesis', () => {
    const sum = SHEET_FORMULA_SUGGESTIONS.find((suggestion) => suggestion.name === 'SUM')
    expect(sum).toBeDefined()

    const applied = applyFormulaSuggestion('=SU(', 1, 3, sum!)

    expect(applied.value).toBe('=SUM(')
    expect(applied.cursor).toBe(5)
  })
})
