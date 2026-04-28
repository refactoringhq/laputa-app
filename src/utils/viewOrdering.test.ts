import { describe, expect, it } from 'vitest'
import type { ViewFile } from '../types'
import {
  buildViewOrderUpdates,
  canMoveView,
  moveView,
  nextViewOrder,
  orderViewsByFilename,
} from './viewOrdering'

function makeView(filename: string, name: string, order: number | null = null): ViewFile {
  return {
    filename,
    definition: {
      name,
      icon: null,
      color: null,
      order,
      sort: null,
      filters: { all: [] },
    },
  }
}

describe('viewOrdering', () => {
  const views = [
    makeView('alpha.yml', 'Alpha', 0),
    makeView('beta.yml', 'Beta', 1),
    makeView('gamma.yml', 'Gamma', 2),
  ]

  it('moves a view up or down without mutating the input order', () => {
    expect(moveView(views, 'beta.yml', 'up')?.map((view) => view.filename)).toEqual([
      'beta.yml',
      'alpha.yml',
      'gamma.yml',
    ])
    expect(moveView(views, 'beta.yml', 'down')?.map((view) => view.filename)).toEqual([
      'alpha.yml',
      'gamma.yml',
      'beta.yml',
    ])
    expect(views.map((view) => view.filename)).toEqual(['alpha.yml', 'beta.yml', 'gamma.yml'])
  })

  it('blocks moves outside the list bounds', () => {
    expect(canMoveView(views, 'alpha.yml', 'up')).toBe(false)
    expect(canMoveView(views, 'gamma.yml', 'down')).toBe(false)
    expect(moveView(views, 'missing.yml', 'up')).toBeNull()
  })

  it('orders views by a complete filename list', () => {
    expect(orderViewsByFilename(views, ['gamma.yml', 'alpha.yml', 'beta.yml'])?.map((view) => view.filename)).toEqual([
      'gamma.yml',
      'alpha.yml',
      'beta.yml',
    ])
  })

  it('rejects incomplete, duplicate, or unknown filename orders', () => {
    expect(orderViewsByFilename(views, ['alpha.yml', 'beta.yml'])).toBeNull()
    expect(orderViewsByFilename(views, ['alpha.yml', 'alpha.yml', 'gamma.yml'])).toBeNull()
    expect(orderViewsByFilename(views, ['alpha.yml', 'beta.yml', 'missing.yml'])).toBeNull()
  })

  it('builds dense order updates while preserving view definitions', () => {
    expect(buildViewOrderUpdates([views[2], views[0]]).map(({ filename, definition }) => ({
      filename,
      name: definition.name,
      order: definition.order,
    }))).toEqual([
      { filename: 'gamma.yml', name: 'Gamma', order: 0 },
      { filename: 'alpha.yml', name: 'Alpha', order: 1 },
    ])
  })

  it('places new views after the highest explicit order', () => {
    expect(nextViewOrder(views)).toBe(3)
    expect(nextViewOrder([makeView('untitled.yml', 'Untitled')])).toBe(1)
  })
})
