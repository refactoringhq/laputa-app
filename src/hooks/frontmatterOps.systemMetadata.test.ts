import { describe, expect, it } from 'vitest'
import type { VaultEntry } from '../types'
import { contentToEntryPatch, frontmatterToEntryPatch } from './frontmatterOps'

describe('frontmatterOps system metadata', () => {
  it.each([
    ['_icon', 'rocket', { icon: 'rocket' }],
    ['icon', 'rocket', { icon: 'rocket' }],
    ['_order', 4, { order: 4 }],
    ['order', 4, { order: 4 }],
    ['_sort', 'title:asc', { sort: 'title:asc' }],
    ['sort', 'title:asc', { sort: 'title:asc' }],
    ['_sidebar_label', 'Projects', { sidebarLabel: 'Projects' }],
    ['sidebar label', 'Projects', { sidebarLabel: 'Projects' }],
  ] as [string, unknown, Partial<VaultEntry>][])('maps %s to the expected entry field', (key, value, expected) => {
    expect(frontmatterToEntryPatch('update', key, value as never).patch).toEqual(expected)
  })

  it('maps canonical delete keys for system metadata', () => {
    expect(frontmatterToEntryPatch('delete', '_icon').patch).toEqual({ icon: null })
    expect(frontmatterToEntryPatch('delete', '_sidebar_label').patch).toEqual({ sidebarLabel: null })
    expect(frontmatterToEntryPatch('delete', '_order').patch).toEqual({ order: null })
    expect(frontmatterToEntryPatch('delete', '_sort').patch).toEqual({ sort: null })
  })

  it('keeps canonical system metadata out of custom properties', () => {
    const patch = contentToEntryPatch(
      '---\ntype: Type\n_icon: rocket\n_order: 4\n_sidebar_label: Projects\n_sort: title:asc\n_internal: secret\nOwner: Luca\n---\n# Project\n',
    )

    expect(patch).toEqual({
      isA: 'Type',
      icon: 'rocket',
      order: 4,
      sidebarLabel: 'Projects',
      sort: 'title:asc',
      properties: { Owner: 'Luca' },
    })
  })
})
