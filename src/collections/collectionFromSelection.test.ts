import { describe, expect, it } from 'vitest'
import type { ViewDefinition, ViewFile } from '../types'
import { makeEntry } from '../test-utils/noteListTestUtils'
import { collectionFromSelection } from './collectionFromSelection'

function emptyFilters(): ViewDefinition['filters'] {
  return { all: [] }
}

function makeView(definition: Partial<ViewDefinition> = {}): ViewFile {
  return {
    filename: 'active-projects.yml',
    definition: {
      name: 'Active Projects',
      icon: null,
      color: null,
      sort: 'modified:desc',
      listPropertiesDisplay: ['status'],
      filters: emptyFilters(),
      ...definition,
    },
  }
}

describe('collectionFromSelection', () => {
  it('maps built-in filters to list-presented collections', () => {
    const collection = collectionFromSelection({ kind: 'filter', filter: 'all' })

    expect(collection).toMatchObject({
      id: 'builtin:all',
      label: 'All Notes',
      origin: 'builtin',
      presentation: { type: 'list', sort: null, properties: [] },
    })
  })

  it('maps type and folder selections without requiring saved YAML', () => {
    expect(collectionFromSelection({ kind: 'sectionGroup', type: 'Project' })).toMatchObject({
      id: 'type:Project',
      label: 'Project',
      origin: 'type',
    })

    expect(collectionFromSelection({ kind: 'folder', path: 'clients', rootPath: '/vault' })).toMatchObject({
      id: 'folder:/vault:clients',
      label: 'clients',
      origin: 'folder',
    })
  })

  it('maps neighborhood selections to a collection around the source note', () => {
    const entry = makeEntry({ path: '/vault/alpha.md', title: 'Alpha' })
    const collection = collectionFromSelection({ kind: 'entity', entry })

    expect(collection).toMatchObject({
      id: 'neighborhood:/vault/alpha.md',
      label: 'Alpha',
      origin: 'neighborhood',
      entry,
    })
  })

  it('normalizes legacy saved-view list settings into presentation config', () => {
    const view = makeView()
    const collection = collectionFromSelection(
      { kind: 'view', filename: view.filename },
      { views: [view] },
    )

    expect(collection).toMatchObject({
      id: 'saved-view::active-projects.yml',
      label: 'Active Projects',
      origin: 'saved-view',
      filter: view.definition.filters,
      presentation: { type: 'list', sort: 'modified:desc', properties: ['status'] },
      view,
    })
  })

  it('lets nested list presentation config override legacy saved-view fields in memory', () => {
    const view = makeView({
      presentation: {
        type: 'list',
        sort: 'title:asc',
        properties: ['Owner'],
      },
    } as Partial<ViewDefinition>)

    const collection = collectionFromSelection(
      { kind: 'view', filename: view.filename },
      { views: [view] },
    )

    expect(collection.presentation).toEqual({
      type: 'list',
      sort: 'title:asc',
      properties: ['Owner'],
    })
  })
})
