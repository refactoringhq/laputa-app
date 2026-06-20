import { describe, expect, it, vi } from 'vitest'
import { resolveExternalSheetDependencyEntries, sheetHasExternalFormulaReferences } from './sheetWorkbook'
import type { VaultEntry } from '../types'

vi.mock('@ironcalc/workbook', () => ({
  Model: class MockModel {},
}))

function entry(path: string, title: string): VaultEntry {
  return {
    aliases: [],
    filename: path.split('/').at(-1) ?? path,
    isA: 'Sheet',
    path,
    title,
  }
}

describe('sheetWorkbook', () => {
  it('detects external formula references in the sheet body only', () => {
    expect(sheetHasExternalFormulaReferences('---\n_sheet: [[not-a-body-reference]].B2\n---\nMetric,Value'))
      .toBe(false)
    expect(sheetHasExternalFormulaReferences('---\ntype: Sheet\n---\nMetric,Value\nRevenue,=[[revenue]].B2'))
      .toBe(true)
  })

  it('resolves loaded transitive external sheet dependency entries without self references', () => {
    const sourceEntry = entry('/vault/business-plan.md', 'Business Plan')
    const modelEntry = entry('/vault/model.md', 'Model')
    const assumptionsEntry = entry('/vault/assumptions.md', 'Assumptions')
    const currentContent = '---\ntype: Sheet\n---\nMetric,Value\nProjected,=[[model]].B2+[[business-plan]].B2'
    const contentsByPath = new Map([
      [modelEntry.path, '---\ntype: Sheet\n---\nMetric,Value\nGrowth,=[[assumptions]].B2'],
      [assumptionsEntry.path, '---\ntype: Sheet\n---\nMetric,Value\nGrowth,0.12'],
    ])

    const dependencies = resolveExternalSheetDependencyEntries({
      content: currentContent,
      contentsByPath,
      currentPath: sourceEntry.path,
      entries: [modelEntry, assumptionsEntry, sourceEntry],
      sourceEntry,
    })

    expect(dependencies.map((dependency) => dependency.path)).toEqual([
      modelEntry.path,
      assumptionsEntry.path,
    ])
  })
})
