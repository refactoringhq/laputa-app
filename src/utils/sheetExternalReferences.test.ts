import { describe, expect, it } from 'vitest'
import {
  extractSheetExternalCellReferences,
  extractSheetExternalFrontmatterReferences,
  extractSheetExternalLineReferences,
  extractSheetExternalReferenceTargets,
  hasSheetExternalFrontmatterReferences,
  isExternalFormulaInput,
  shiftExternalFormulaReferences,
} from './sheetExternalReferences'

describe('sheetExternalReferences', () => {
  it('detects formula inputs with sheet wikilink cell references', () => {
    expect(isExternalFormulaInput('=[[revenue]].B2')).toBe(true)
    expect(isExternalFormulaInput('=[[device]].power.watts')).toBe(true)
    expect(isExternalFormulaInput('=[[brief]].2')).toBe(true)
    expect(isExternalFormulaInput(' [[revenue]].B2')).toBe(false)
    expect(isExternalFormulaInput('[[revenue]].B2')).toBe(false)
  })

  it('extracts canonical targets and A1 addresses', () => {
    expect(extractSheetExternalCellReferences('=[[folder/revenue|Revenue]].$B$12+[[costs]].C3')).toEqual([
      { address: 'B12', target: 'folder/revenue' },
      { address: 'C3', target: 'costs' },
    ])
  })

  it('extracts canonical targets and frontmatter property paths', () => {
    expect(extractSheetExternalFrontmatterReferences('=[[device.md]].power.watts+[[project-alpha|Project]].status')).toEqual([
      { path: ['power', 'watts'], propertyPath: 'power.watts', target: 'device.md' },
      { path: ['status'], propertyPath: 'status', target: 'project-alpha' },
    ])
  })

  it('extracts canonical targets and raw body line references', () => {
    expect(extractSheetExternalLineReferences('=[[brief|Brief]].1 & [[notes/daily]].12')).toEqual([
      { line: 1, target: 'brief' },
      { line: 12, target: 'notes/daily' },
    ])
  })

  it('keeps cell references out of frontmatter property extraction', () => {
    expect(hasSheetExternalFrontmatterReferences({ value: '=[[revenue]].B2+[[revenue]].$B$2+[[brief]].1' })).toBe(false)
    expect(extractSheetExternalReferenceTargets('=[[device]].power.watts+[[revenue]].B2+[[brief]].1')).toEqual([
      'revenue',
      'brief',
      'device',
    ])
  })

  it('shifts relative references while preserving absolute row and column markers', () => {
    expect(shiftExternalFormulaReferences('=[[revenue]].B2+[[revenue]].$C$3+[[revenue]].D$4+[[revenue]].$E5', 2, 1))
      .toBe('=[[revenue]].C4+[[revenue]].$C$3+[[revenue]].E$4+[[revenue]].$E7')
  })

  it('leaves frontmatter property references unchanged when shifting formulas', () => {
    expect(shiftExternalFormulaReferences('=[[device]].power.watts+[[brief]].2+[[revenue]].B2', 2, 1))
      .toBe('=[[device]].power.watts+[[brief]].2+[[revenue]].C4')
  })

  it('leaves references unchanged when a relative shift would leave the sheet bounds', () => {
    expect(shiftExternalFormulaReferences('=[[revenue]].A1', -1, 0)).toBe('=[[revenue]].A1')
  })
})
