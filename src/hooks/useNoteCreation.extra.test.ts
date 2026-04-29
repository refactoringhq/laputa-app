import { describe, it, expect } from 'vitest'
import type { VaultEntry } from '../types'
import {
  slugify,
  buildNewEntry,
  generateUntitledName,
  entryMatchesTarget,
  buildNoteContent,
  resolveNewNote,
  resolveNewType,
  DEFAULT_TEMPLATES,
  resolveTemplate,
} from './useNoteCreation'

const makeEntry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  path: '/Users/luca/Laputa/test.md',
  filename: 'test.md',
  title: 'Test Note',
  isA: 'Note',
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: 'Active',
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  outgoingLinks: [],
  template: null,
  sort: null,
  sidebarLabel: null,
  view: null,
  visible: null,
  properties: {},
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  hasH1: false,
  ...overrides,
})

describe('slugify', () => {
  it('converts text to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('removes special characters', () => {
    expect(slugify('My Project! @#$%')).toBe('my-project')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello')
  })

  it('handles empty string with fallback', () => {
    expect(slugify('')).toBe('untitled')
  })

  it('collapses multiple separators into one hyphen', () => {
    expect(slugify('hello   world---foo')).toBe('hello-world-foo')
  })

  it('returns fallback for strings with only special characters', () => {
    // slugify('+++') should not return empty string — it causes invalid paths
    expect(slugify('+++')).not.toBe('')
    expect(slugify('!!!')).not.toBe('')
    expect(slugify('---')).not.toBe('')
    expect(slugify('@#$')).not.toBe('')
  })
})

describe('buildNewEntry', () => {
  it('creates a VaultEntry with correct fields', () => {
    const entry = buildNewEntry({
      path: '/vault/my-note.md',
      slug: 'my-note',
      title: 'My Note',
      type: 'Note',
      status: 'Active',
    })

    expect(entry.path).toBe('/vault/my-note.md')
    expect(entry.filename).toBe('my-note.md')
    expect(entry.title).toBe('My Note')
    expect(entry.isA).toBe('Note')
    expect(entry.status).toBe('Active')
    expect(entry.archived).toBe(false)
    expect(entry.modifiedAt).toBeGreaterThan(0)
    expect(entry.createdAt).toBe(entry.modifiedAt)
  })

  it('sets null status when provided', () => {
    const entry = buildNewEntry({
      path: '/vault/topic/ai.md',
      slug: 'ai',
      title: 'AI',
      type: 'Topic',
      status: null,
    })
    expect(entry.status).toBeNull()
  })
})

describe('generateUntitledName', () => {
  it('returns base name when no conflicts', () => {
    expect(generateUntitledName({ entries: [], type: 'Note' })).toBe('Untitled note')
  })

  it('appends counter when base name exists', () => {
    const entries = [makeEntry({ title: 'Untitled note' })]
    expect(generateUntitledName({ entries, type: 'Note' })).toBe('Untitled note 2')
  })

  it('increments counter past existing numbered entries', () => {
    const entries = [
      makeEntry({ title: 'Untitled note' }),
      makeEntry({ title: 'Untitled note 2' }),
      makeEntry({ title: 'Untitled note 3' }),
    ]
    expect(generateUntitledName({ entries, type: 'Note' })).toBe('Untitled note 4')
  })

  it('uses type name in lowercase', () => {
    expect(generateUntitledName({ entries: [], type: 'Project' })).toBe('Untitled project')
  })

  it('avoids names in the pending set', () => {
    const pending = new Set(['Untitled note'])
    expect(generateUntitledName({ entries: [], type: 'Note', pendingTitles: pending })).toBe('Untitled note 2')
  })

  it('avoids both existing and pending names', () => {
    const entries = [makeEntry({ title: 'Untitled note' })]
    const pending = new Set(['Untitled note 2'])
    expect(generateUntitledName({ entries, type: 'Note', pendingTitles: pending })).toBe('Untitled note 3')
  })
})

describe('entryMatchesTarget', () => {
  it('matches by exact title (case-insensitive)', () => {
    const entry = makeEntry({ title: 'My Project' })
    expect(entryMatchesTarget({ entry, target: 'my project' })).toBe(true)
  })

  it('matches by alias', () => {
    const entry = makeEntry({ aliases: ['MP', 'TheProject'] })
    expect(entryMatchesTarget({ entry, target: 'mp' })).toBe(true)
  })

  it('matches legacy path-style target via filename stem', () => {
    const entry = makeEntry({ filename: 'my-project.md' })
    expect(entryMatchesTarget({ entry, target: 'project/my-project' })).toBe(true)
  })

  it('matches by filename stem', () => {
    const entry = makeEntry({ filename: 'my-project.md' })
    expect(entryMatchesTarget({ entry, target: 'my-project' })).toBe(true)
  })

  it('matches when target as words matches title', () => {
    const entry = makeEntry({ title: 'my project' })
    expect(entryMatchesTarget({ entry, target: 'my-project' })).toBe(true)
  })

  it('returns false when nothing matches', () => {
    const entry = makeEntry({ title: 'Something Else', aliases: [], filename: 'else.md' })
    expect(entryMatchesTarget({ entry, target: 'nonexistent' })).toBe(false)
  })

  it('handles pipe syntax targets', () => {
    const entry = makeEntry({ path: '/vault/project/alpha.md', filename: 'alpha.md', title: 'Alpha' })
    expect(entryMatchesTarget({ entry, target: 'project/alpha|Alpha Project' })).toBe(true)
  })
})

describe('buildNoteContent', () => {
  it('generates frontmatter with title and status for regular types', () => {
    const content = buildNoteContent({ title: 'My Note', type: 'Note', status: 'Active' })
    expect(content).toBe('---\ntitle: My Note\ntype: Note\nstatus: Active\n---\n')
  })

  it('omits title when null', () => {
    const content = buildNoteContent({ title: null, type: 'Note', status: 'Active' })
    expect(content).toBe('---\ntype: Note\nstatus: Active\n---\n')
  })

  it('omits status when null', () => {
    const content = buildNoteContent({ title: 'AI', type: 'Topic', status: null })
    expect(content).toBe('---\ntitle: AI\ntype: Topic\n---\n')
  })

  it('includes template body when provided', () => {
    const content = buildNoteContent({ title: 'My Project', type: 'Project', status: 'Active', template: '## Objective\n\n## Notes\n\n' })
    expect(content).not.toContain('# My Project')
    expect(content).toContain('## Objective')
    expect(content).toContain('## Notes')
  })

  it('ignores null template', () => {
    const content = buildNoteContent({ title: 'My Note', type: 'Note', status: 'Active', template: null })
    expect(content).toBe('---\ntitle: My Note\ntype: Note\nstatus: Active\n---\n')
  })

  it('prepends an empty H1 for untitled-note creation flows', () => {
    const content = buildNoteContent({ title: null, type: 'Note', status: 'Active', initialEmptyHeading: true })
    expect(content).toBe('---\ntype: Note\nstatus: Active\n---\n\n# \n\n')
  })

  it('keeps the empty H1 ahead of templates for typed untitled notes', () => {
    const content = buildNoteContent({
      title: null,
      type: 'Project',
      status: 'Active',
      template: '## Objective\n\n## Notes\n\n',
      initialEmptyHeading: true,
    })
    expect(content).toBe('---\ntype: Project\nstatus: Active\n---\n\n# \n\n## Objective\n\n## Notes\n\n')
  })
})

describe('resolveTemplate', () => {
  it('returns template from type entry when set', () => {
    const typeEntry = makeEntry({ isA: 'Type', title: 'Recipe', template: '## Ingredients\n\n## Steps\n\n' })
    expect(resolveTemplate({ entries: [typeEntry], typeName: 'Recipe' })).toBe('## Ingredients\n\n## Steps\n\n')
  })

  it('falls back to DEFAULT_TEMPLATES for built-in types', () => {
    expect(resolveTemplate({ entries: [], typeName: 'Project' })).toBe(DEFAULT_TEMPLATES.Project)
  })

  it('returns null when no template and no default', () => {
    expect(resolveTemplate({ entries: [], typeName: 'CustomType' })).toBeNull()
  })

  it('type entry template overrides default', () => {
    const typeEntry = makeEntry({ isA: 'Type', title: 'Project', template: '## Custom\n\n' })
    expect(resolveTemplate({ entries: [typeEntry], typeName: 'Project' })).toBe('## Custom\n\n')
  })
})

describe('DEFAULT_TEMPLATES', () => {
  it('has templates for Project, Person, Responsibility, Experiment', () => {
    expect(DEFAULT_TEMPLATES.Project).toBeDefined()
    expect(DEFAULT_TEMPLATES.Person).toBeDefined()
    expect(DEFAULT_TEMPLATES.Responsibility).toBeDefined()
    expect(DEFAULT_TEMPLATES.Experiment).toBeDefined()
  })
})

describe('resolveNewNote', () => {
  it('creates note at vault root', () => {
    const { entry, content } = resolveNewNote({ title: 'My Project', type: 'Project', vaultPath: '/my/vault' })
    expect(entry.path).toBe('/my/vault/my-project.md')
    expect(entry.isA).toBe('Project')
    expect(entry.status).toBeNull()
    expect(content).toContain('type: Project')
    expect(content).not.toContain('status:')
  })

  it('creates custom type note at vault root', () => {
    const { entry, content } = resolveNewNote({ title: 'First Recipe', type: 'Recipe', vaultPath: '/my/vault' })
    expect(entry.path).toBe('/my/vault/first-recipe.md')
    expect(entry.status).toBeNull()
    expect(content).not.toContain('status:')
  })

  it('omits status for Topic type', () => {
    const { entry, content } = resolveNewNote({ title: 'Machine Learning', type: 'Topic', vaultPath: '/my/vault' })
    expect(entry.status).toBeNull()
    expect(content).not.toContain('status:')
  })

  it('omits status for Person type', () => {
    const { entry } = resolveNewNote({ title: 'John Doe', type: 'Person', vaultPath: '/my/vault' })
    expect(entry.status).toBeNull()
  })

  it('uses provided vault path', () => {
    const { entry, content } = resolveNewNote({ title: 'Test', type: 'Note', vaultPath: '/other/vault' })
    expect(entry.path).toBe('/other/vault/test.md')
    expect(entry.status).toBeNull()
    expect(content).not.toContain('status:')
  })

  it('produces a valid path for custom types with special characters', () => {
    const { entry } = resolveNewNote({ title: 'My Note', type: 'Q&A', vaultPath: '/vault' })
    expect(entry.path).not.toContain('//')
    expect(entry.path).toMatch(/\.md$/)
    expect(entry.filename).not.toBe('.md')
  })

  it('produces a valid path when type is all special characters', () => {
    const { entry } = resolveNewNote({ title: 'My Note', type: '+++', vaultPath: '/vault' })
    expect(entry.path).not.toContain('//')
    expect(entry.path).toMatch(/\.md$/)
  })
})

describe('resolveNewType', () => {
  it('creates a type entry in the canonical type directory', () => {
    const { entry, content } = resolveNewType({ typeName: 'Recipe', vaultPath: '/my/vault' })
    expect(entry.path).toBe('/my/vault/type/recipe.md')
    expect(entry.isA).toBe('Type')
    expect(entry.status).toBeNull()
    expect(content).toContain('type: Type')
    expect(content).toContain('# Recipe')
  })

  it('uses provided vault path instead of hardcoded path', () => {
    const { entry } = resolveNewType({ typeName: 'Responsibility', vaultPath: '/other/vault' })
    expect(entry.path).toBe('/other/vault/type/responsibility.md')
    expect(entry.path).not.toContain('/Users/luca/Laputa')
  })
})
