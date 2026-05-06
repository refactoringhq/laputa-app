import { describe, it, expect } from 'vitest'
import { buildSectionGroup, buildDynamicSections, collectActiveTypes } from '../utils/sidebarSections'
import { resolveIcon } from '../utils/iconRegistry'
import type { VaultEntry } from '../types'
import { GearSix, CookingPot, FileText } from '@phosphor-icons/react'

const baseEntry: VaultEntry = {
  path: '', filename: '', title: '', isA: null, aliases: [], belongsTo: [], relatedTo: [],
  status: null, archived: false,
  modifiedAt: null, createdAt: null, fileSize: 0, snippet: '', relationships: {},
  wordCount: 0,
  icon: null, color: null, order: null, sidebarLabel: null, template: null, sort: null,
  view: null, visible: null, outgoingLinks: [], properties: {},
}

describe('buildSectionGroup', () => {
  it('uses type entry icon/color/sidebarLabel for custom type', () => {
    const typeEntryMap: Record<string, VaultEntry> = {
      Config: { ...baseEntry, title: 'Config', isA: 'Type', icon: 'gear-six', color: 'blue', sidebarLabel: 'Config' },
    }
    const group = buildSectionGroup('Config', typeEntryMap)
    expect(group.label).toBe('Config')
    expect(group.customColor).toBe('blue')
    expect(group.Icon).toBe(GearSix)
  })

  it('uses type entry icon/color for custom type with custom icon', () => {
    const typeEntryMap: Record<string, VaultEntry> = {
      Recipe: { ...baseEntry, title: 'Recipe', isA: 'Type', icon: 'cooking-pot', color: 'orange' },
    }
    const group = buildSectionGroup('Recipe', typeEntryMap)
    expect(group.label).toBe('Recipes')
    expect(group.customColor).toBe('orange')
    expect(group.Icon).toBe(CookingPot)
  })

  it('falls back to pluralized name and FileText when no type entry', () => {
    const group = buildSectionGroup('Widget', {})
    expect(group.label).toBe('Widgets')
    expect(group.customColor).toBeNull()
    expect(group.Icon).toBe(FileText)
  })

  it('uses exact type names when automatic pluralization is disabled', () => {
    const group = buildSectionGroup('Widget', {}, false)
    expect(group.label).toBe('Widget')
  })

  it('overrides built-in type icon/color when type entry has custom values', () => {
    const typeEntryMap: Record<string, VaultEntry> = {
      Project: { ...baseEntry, title: 'Project', isA: 'Type', icon: 'rocket', color: 'green', sidebarLabel: 'My Projects' },
    }
    const group = buildSectionGroup('Project', typeEntryMap)
    expect(group.label).toBe('My Projects')
    expect(group.customColor).toBe('green')
    expect(group.Icon).toBe(resolveIcon('rocket'))
  })

  it('uses gray color for Config type', () => {
    const typeEntryMap: Record<string, VaultEntry> = {
      Config: { ...baseEntry, title: 'Config', isA: 'Type', icon: 'gear-six', color: 'gray', sidebarLabel: 'Config' },
    }
    const group = buildSectionGroup('Config', typeEntryMap)
    expect(group.customColor).toBe('gray')
  })

  it('resolves type entry via lowercase key (case-insensitive isA)', () => {
    // When instances have isA: 'config' (lowercase) but type entry title is 'Config'
    const typeEntryMap: Record<string, VaultEntry> = {
      Config: { ...baseEntry, title: 'Config', isA: 'Type', icon: 'gear-six', color: 'gray', sidebarLabel: 'Config' },
      config: { ...baseEntry, title: 'Config', isA: 'Type', icon: 'gear-six', color: 'gray', sidebarLabel: 'Config' },
    }
    const group = buildSectionGroup('config', typeEntryMap)
    expect(group.label).toBe('Config')
    expect(group.customColor).toBe('gray')
    expect(group.Icon).toBe(GearSix)
  })
})

describe('buildDynamicSections', () => {
  it('includes types with 0 notes from typeEntryMap', () => {
    const entries: VaultEntry[] = [
      { ...baseEntry, title: 'My Note', isA: 'Note' },
    ]
    const typeEntryMap: Record<string, VaultEntry> = {
      Recipe: { ...baseEntry, title: 'Recipe', isA: 'Type', icon: 'cooking-pot' },
      recipe: { ...baseEntry, title: 'Recipe', isA: 'Type', icon: 'cooking-pot' },
    }
    const sections = buildDynamicSections(entries, typeEntryMap)
    const types = sections.map((s) => s.type)
    expect(types).toContain('Note')
    expect(types).toContain('Recipe')
  })

  it('does not duplicate types that have both entries and type definitions', () => {
    const entries: VaultEntry[] = [
      { ...baseEntry, title: 'My Project', isA: 'Project' },
    ]
    const typeEntryMap: Record<string, VaultEntry> = {
      Project: { ...baseEntry, title: 'Project', isA: 'Type' },
      project: { ...baseEntry, title: 'Project', isA: 'Type' },
    }
    const sections = buildDynamicSections(entries, typeEntryMap)
    const projectSections = sections.filter((s) => s.type === 'Project')
    expect(projectSections).toHaveLength(1)
  })

  it('excludes archived type definitions', () => {
    const entries: VaultEntry[] = []
    const typeEntryMap: Record<string, VaultEntry> = {
      Old: { ...baseEntry, title: 'Old', isA: 'Type', archived: true },
    }
    const sections = buildDynamicSections(entries, typeEntryMap)
    expect(sections.map((s) => s.type)).not.toContain('Old')
  })

  it('excludes the legacy Journal section even when journal notes still exist', () => {
    const entries: VaultEntry[] = [
      { ...baseEntry, title: 'Daily Log', isA: 'Journal' },
    ]

    const sections = buildDynamicSections(entries, {})

    expect(sections.map((section) => section.type)).not.toContain('Journal')
  })

  it('includes Journal when a real Journal type definition exists', () => {
    const entries: VaultEntry[] = [
      { ...baseEntry, title: 'Daily Log', isA: 'journal' },
    ]
    const typeEntryMap: Record<string, VaultEntry> = {
      Journal: { ...baseEntry, title: 'Journal', isA: 'Type' },
      journal: { ...baseEntry, title: 'Journal', isA: 'Type' },
    }

    const sections = buildDynamicSections(entries, typeEntryMap)

    expect(sections.filter((section) => section.type === 'Journal')).toHaveLength(1)
  })
})

describe('collectActiveTypes', () => {
  it('excludes non-markdown entries from type collection', () => {
    const entries: VaultEntry[] = [
      { ...baseEntry, title: 'My Note', isA: 'Note', fileKind: 'markdown' },
      { ...baseEntry, title: 'config.yml', isA: null, fileKind: 'text' },
      { ...baseEntry, title: 'photo.png', isA: null, fileKind: 'binary' },
    ]
    const types = collectActiveTypes(entries)
    expect(types).toContain('Note')
    expect(types.size).toBe(1)
  })

  it('treats entries without fileKind as markdown', () => {
    const entries: VaultEntry[] = [
      { ...baseEntry, title: 'Legacy Note', isA: 'Note' },
    ]
    const types = collectActiveTypes(entries)
    expect(types).toContain('Note')
  })
})
