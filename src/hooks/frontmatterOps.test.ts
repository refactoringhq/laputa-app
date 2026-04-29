import { describe, it, expect } from 'vitest'
import type { VaultEntry } from '../types'
import { frontmatterToEntryPatch, applyRelationshipPatch, contentToEntryPatch } from './frontmatterOps'

describe('frontmatterToEntryPatch', () => {
  it.each([
    ['title', 'My Note', { title: 'My Note' }],
    ['type', 'Project', { isA: 'Project' }],
    ['is_a', 'Project', { isA: 'Project' }],
    ['status', 'Done', { status: 'Done' }],
    ['color', 'red', { color: 'red' }],
    ['icon', 'star', { icon: 'star' }],
    ['sidebar_label', 'Projects', { sidebarLabel: 'Projects' }],
    ['archived', true, { archived: true }],
    ['order', 5, { order: 5 }],
    ['template', '## Heading\n\n', { template: '## Heading\n\n' }],
    ['_width', 'wide', { noteWidth: 'wide' }],
    ['width', 'normal', { noteWidth: 'normal' }],
    ['visible', false, { visible: false }],
    ['visible', true, { visible: null }],
  ] as [string, unknown, Partial<VaultEntry>][])(
    'maps %s update to correct entry field',
    (key, value, expected) => {
      expect(frontmatterToEntryPatch('update', key, value as never).patch).toEqual(expected)
    },
  )

  it('maps aliases update with array value', () => {
    expect(frontmatterToEntryPatch('update', 'aliases', ['A', 'B']).patch).toEqual({ aliases: ['A', 'B'] })
  })

  it('maps belongs_to update with array value', () => {
    const result = frontmatterToEntryPatch('update', 'belongs_to', ['[[parent]]'])
    expect(result.patch).toEqual({ belongsTo: ['[[parent]]'] })
    // Also produces a relationship patch for the wikilink
    expect(result.relationshipPatch).toEqual({ 'belongs_to': ['[[parent]]'] })
  })

  it('handles case-insensitive keys with spaces (e.g. "Is A", "Belongs to")', () => {
    expect(frontmatterToEntryPatch('update', 'Is A', 'Experiment').patch).toEqual({ isA: 'Experiment' })
    const result = frontmatterToEntryPatch('update', 'Belongs to', ['[[x]]'])
    expect(result.patch).toEqual({ belongsTo: ['[[x]]'] })
    expect(result.relationshipPatch).toEqual({ 'Belongs to': ['[[x]]'] })
  })

  it('returns propertiesPatch for unknown non-wikilink keys', () => {
    const result = frontmatterToEntryPatch('update', 'custom_field', 'value')
    expect(result.patch).toEqual({})
    expect(result.propertiesPatch).toEqual({ custom_field: 'value' })
    // Non-wikilink value → no relationship change
    expect(result.relationshipPatch).toBeNull()
  })

  it('produces relationship patch for wikilink values on unknown keys', () => {
    const result = frontmatterToEntryPatch('update', 'Notes', ['[[note-a]]', '[[note-b|Note B]]'])
    expect(result.patch).toEqual({})
    expect(result.relationshipPatch).toEqual({ Notes: ['[[note-a]]', '[[note-b|Note B]]'] })
  })

  it('produces relationship patch for single wikilink string', () => {
    const result = frontmatterToEntryPatch('update', 'Owner', '[[person/alice]]')
    expect(result.patch).toEqual({})
    expect(result.relationshipPatch).toEqual({ Owner: ['[[person/alice]]'] })
  })

  it.each([
    ['status', { status: null }],
    ['color', { color: null }],
    ['aliases', { aliases: [] }],
    ['archived', { archived: false }],
    ['order', { order: null }],
    ['template', { template: null }],
    ['_width', { noteWidth: null }],
    ['visible', { visible: null }],
  ] as [string, Partial<VaultEntry>][])(
    'maps delete of %s to null/default',
    (key, expected) => {
      expect(frontmatterToEntryPatch('delete', key).patch).toEqual(expected)
    },
  )

  it('maps _list_properties_display update to listPropertiesDisplay array', () => {
    const result = frontmatterToEntryPatch('update', '_list_properties_display', ['rating', 'genre'])
    expect(result.patch).toEqual({ listPropertiesDisplay: ['rating', 'genre'] })
  })

  it('maps _list_properties_display delete to empty array', () => {
    const result = frontmatterToEntryPatch('delete', '_list_properties_display')
    expect(result.patch).toEqual({ listPropertiesDisplay: [] })
  })

  it('returns empty patch for unknown key on delete, with relationship and properties removal', () => {
    const result = frontmatterToEntryPatch('delete', 'unknown_key')
    expect(result.patch).toEqual({})
    expect(result.relationshipPatch).toEqual({ unknown_key: null })
    expect(result.propertiesPatch).toEqual({ unknown_key: null })
  })

  it('delete of known key also produces relationship removal', () => {
    const result = frontmatterToEntryPatch('delete', 'status')
    expect(result.patch).toEqual({ status: null })
    expect(result.relationshipPatch).toEqual({ status: null })
  })
})

describe('applyRelationshipPatch', () => {
  it('adds new relationship key', () => {
    const existing = { 'Belongs to': ['[[eng]]'] }
    const result = applyRelationshipPatch(existing, { Notes: ['[[note-a]]', '[[note-b]]'] })
    expect(result).toEqual({ 'Belongs to': ['[[eng]]'], Notes: ['[[note-a]]', '[[note-b]]'] })
  })

  it('overwrites existing relationship key', () => {
    const existing = { Notes: ['[[old]]'] }
    const result = applyRelationshipPatch(existing, { Notes: ['[[new-a]]', '[[new-b]]'] })
    expect(result).toEqual({ Notes: ['[[new-a]]', '[[new-b]]'] })
  })

  it('removes relationship key when value is null', () => {
    const existing = { Notes: ['[[a]]'], Owner: ['[[alice]]'] }
    const result = applyRelationshipPatch(existing, { Notes: null })
    expect(result).toEqual({ Owner: ['[[alice]]'] })
  })

  it('does not mutate the original map', () => {
    const existing = { Notes: ['[[a]]'] }
    applyRelationshipPatch(existing, { Notes: ['[[b]]'] })
    expect(existing).toEqual({ Notes: ['[[a]]'] })
  })
})

describe('contentToEntryPatch', () => {
  it('extracts type from frontmatter', () => {
    const content = '---\ntype: Project\nstatus: Active\n---\nBody text'
    expect(contentToEntryPatch(content)).toEqual({ isA: 'Project', status: 'Active' })
  })

  it('returns empty patch when no frontmatter', () => {
    expect(contentToEntryPatch('Just a body')).toEqual({})
  })

  it('returns empty patch for empty content', () => {
    expect(contentToEntryPatch('')).toEqual({})
  })

  it('extracts color, icon, and aliases', () => {
    const content = '---\ncolor: red\nicon: star\naliases:\n  - Foo\n  - Bar\n---\n'
    expect(contentToEntryPatch(content)).toEqual({ color: 'red', icon: 'star', aliases: ['Foo', 'Bar'] })
  })

  it('handles is_a as alias for type', () => {
    const content = '---\nis_a: Essay\n---\n'
    expect(contentToEntryPatch(content)).toEqual({ isA: 'Essay' })
  })

  it('extracts title from frontmatter', () => {
    const content = '---\ntitle: My Title\ntype: Note\n---\nBody'
    expect(contentToEntryPatch(content)).toEqual({ title: 'My Title', isA: 'Note' })
  })

  it('extracts sidebar_label from frontmatter', () => {
    const content = '---\ntype: Type\nsidebar_label: Projects\n---\n'
    expect(contentToEntryPatch(content)).toEqual({ isA: 'Type', sidebarLabel: 'Projects' })
  })

  it('includes custom frontmatter keys in properties patch', () => {
    const content = '---\ntype: Note\ncustom: value\n---\n'
    expect(contentToEntryPatch(content)).toEqual({ isA: 'Note', properties: { custom: 'value' } })
  })

  it('extracts note width without leaking it into properties', () => {
    const content = '---\ntype: Note\n_width: wide\n---\n'
    expect(contentToEntryPatch(content)).toEqual({ isA: 'Note', noteWidth: 'wide' })
  })

  it('preserves _favorite_index as a number (not null)', () => {
    const content = '---\n_favorite: true\n_favorite_index: 2\n---\nBody'
    const patch = contentToEntryPatch(content)
    expect(patch.favorite).toBe(true)
    expect(patch.favoriteIndex).toBe(2)
  })

  it('preserves _favorite_index: 0 as number 0', () => {
    const content = '---\n_favorite: true\n_favorite_index: 0\n---\nBody'
    const patch = contentToEntryPatch(content)
    expect(patch.favoriteIndex).toBe(0)
  })

  it('preserves order as a number', () => {
    const content = '---\ntype: Type\norder: 3\n---\n'
    expect(contentToEntryPatch(content)).toEqual({ isA: 'Type', order: 3 })
  })
})
