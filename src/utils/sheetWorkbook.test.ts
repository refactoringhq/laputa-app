import { describe, expect, it, vi } from 'vitest'
import {
  resolveExternalFormulaInput,
  resolveExternalSheetDependencyEntries,
  sheetExternalFormulaContext,
  sheetHasExternalFormulaReferences,
} from './sheetWorkbook'
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

function frontmatterFormulaContext(deviceContent: string) {
  const sourceEntry = entry('/vault/loadout.md', 'Loadout')
  const deviceEntry = entry('/vault/device.md', 'Device')
  return sheetExternalFormulaContext({
    contentsByPath: new Map([[deviceEntry.path, deviceContent]]),
    currentPath: sourceEntry.path,
    entries: [sourceEntry, deviceEntry],
    sourceEntry,
  })
}

function expectSingleLoadedDependencyPath(
  content: string,
  dependencyEntry: VaultEntry,
  dependencyContent: string,
) {
  const sourceEntry = entry('/vault/loadout.md', 'Loadout')
  const dependencies = resolveExternalSheetDependencyEntries({
    content,
    contentsByPath: new Map([[dependencyEntry.path, dependencyContent]]),
    currentPath: sourceEntry.path,
    entries: [sourceEntry, dependencyEntry],
    sourceEntry,
  })

  expect(dependencies.map((dependency) => dependency.path)).toEqual([dependencyEntry.path])
}

describe('sheetWorkbook', () => {
  it('detects external formula references in the sheet body only', () => {
    expect(sheetHasExternalFormulaReferences('---\n_sheet: [[not-a-body-reference]].B2\n---\nMetric,Value'))
      .toBe(false)
    expect(sheetHasExternalFormulaReferences('---\ntype: Sheet\n---\nMetric,Value\nRevenue,=[[revenue]].B2'))
      .toBe(true)
    expect(sheetHasExternalFormulaReferences('---\ntype: Sheet\n---\nMetric,Value\nWatts,=[[device]].power.watts'))
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

  it('resolves external note frontmatter references into literals or spreadsheet errors', () => {
    const context = frontmatterFormulaContext([
      '---',
      'power:',
      '  watts: 120',
      'status: Active',
      'enabled: true',
      'tags:',
      '  - hardware',
      '---',
      '# Device',
    ].join('\n'))

    expect(resolveExternalFormulaInput('=[[device]].power.watts*2', context)).toEqual({
      evaluated: '=120*2',
      source: '=[[device]].power.watts*2',
    })
    expect(resolveExternalFormulaInput('=[[device.md]].status', context)?.evaluated).toBe('="Active"')
    expect(resolveExternalFormulaInput('=[[device]].enabled', context)?.evaluated).toBe('=TRUE()')
    expect(resolveExternalFormulaInput('=[[device]].power.volts', context)?.evaluated).toBe('=NA()')
    expect(resolveExternalFormulaInput('=[[device]].power', context)?.evaluated).toBe('=NA()')
    expect(resolveExternalFormulaInput('=[[device]].tags', context)?.evaluated).toBe('=NA()')
  })

  it('resolves raw body line references without treating commas as cell separators', () => {
    const sourceEntry = entry('/vault/loadout.md', 'Loadout')
    const briefEntry = entry('/vault/brief.md', 'Brief')
    const context = sheetExternalFormulaContext({
      contentsByPath: new Map([
        [briefEntry.path, [
          '---',
          'status: Draft',
          '---',
          '# Brief',
          'Budget: 1200, expected',
          '42',
        ].join('\n')],
      ]),
      currentPath: sourceEntry.path,
      entries: [sourceEntry, briefEntry],
      sourceEntry,
    })

    expect(resolveExternalFormulaInput('=[[brief]].2', context)?.evaluated).toBe('="Budget: 1200, expected"')
    expect(resolveExternalFormulaInput('=[[brief]].3+8', context)?.evaluated).toBe('=42+8')
  })

  it('treats ambiguous frontmatter note references as spreadsheet errors', () => {
    const sourceEntry = entry('/vault/loadout.md', 'Loadout')
    const firstDevice = entry('/vault/a/device.md', 'Device')
    const secondDevice = entry('/vault/b/device.md', 'Device')
    const context = sheetExternalFormulaContext({
      contentsByPath: new Map([
        [firstDevice.path, '---\nstatus: Active\n---\n# Device'],
        [secondDevice.path, '---\nstatus: Blocked\n---\n# Device'],
      ]),
      currentPath: sourceEntry.path,
      entries: [sourceEntry, firstDevice, secondDevice],
      sourceEntry,
    })

    expect(resolveExternalFormulaInput('=[[device]].status', context)?.evaluated).toBe('=NA()')
    expect(resolveExternalFormulaInput('=[[a/device]].status', context)?.evaluated).toBe('="Active"')
  })

  it('loads dependencies for frontmatter references', () => {
    const deviceEntry = entry('/vault/device.md', 'Device')
    expectSingleLoadedDependencyPath(
      '---\ntype: Sheet\n---\nMetric,Value\nWatts,=[[device]].power.watts',
      deviceEntry,
      '---\npower:\n  watts: 120\n---\n# Device',
    )
  })

  it('loads dependencies for raw body line references', () => {
    const briefEntry = entry('/vault/brief.md', 'Brief')
    expectSingleLoadedDependencyPath(
      '---\ntype: Sheet\n---\nMetric,Value\nSummary,=[[brief]].2',
      briefEntry,
      '# Brief\nBudget: 1200, expected',
    )
  })
})
