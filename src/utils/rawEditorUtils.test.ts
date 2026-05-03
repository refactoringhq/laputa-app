import { describe, it, expect } from 'vitest'
import type { VaultEntry } from '../types'
import { buildRawEditorBaseItems, detectYamlError, extractWikilinkQuery, getRawEditorDropdownPosition, replaceActiveWikilinkQuery } from './rawEditorUtils'

describe('extractWikilinkQuery', () => {
  it('returns null when no [[ trigger', () => {
    expect(extractWikilinkQuery('hello world', 5)).toBeNull()
  })

  it('returns empty string immediately after [[', () => {
    const text = 'see [['
    expect(extractWikilinkQuery(text, text.length)).toBe('')
  })

  it('returns query after [[', () => {
    const text = 'see [[Proj'
    expect(extractWikilinkQuery(text, text.length)).toBe('Proj')
  })

  it('returns null when ]] closes the link', () => {
    const text = '[[Proj]]'
    expect(extractWikilinkQuery(text, text.length)).toBeNull()
  })

  it('returns null when newline is in query', () => {
    const text = '[[Proj\ncontinued'
    expect(extractWikilinkQuery(text, text.length)).toBeNull()
  })

  it('handles cursor before end of text', () => {
    const text = '[[Proj after'
    expect(extractWikilinkQuery(text, 6)).toBe('Proj')
  })
})

describe('replaceActiveWikilinkQuery', () => {
  it('replaces the active wikilink query with the canonical target', () => {
    expect(replaceActiveWikilinkQuery('See [[Proj', 10, 'projects/alpha')).toEqual({
      text: 'See [[projects/alpha]]',
      cursor: 22,
    })
  })

  it('preserves text after the cursor', () => {
    expect(replaceActiveWikilinkQuery('See [[Proj today', 10, 'projects/alpha')).toEqual({
      text: 'See [[projects/alpha]] today',
      cursor: 22,
    })
  })

  it('returns null when no active wikilink trigger exists', () => {
    expect(replaceActiveWikilinkQuery('See Proj', 8, 'projects/alpha')).toBeNull()
  })
})

describe('detectYamlError', () => {
  it('returns null for content without frontmatter', () => {
    expect(detectYamlError('# Title\n\nSome content.')).toBeNull()
  })

  it('returns null for valid frontmatter', () => {
    expect(detectYamlError('---\ntitle: My Note\n---\n\n# Title')).toBeNull()
  })

  it('returns null for valid CRLF frontmatter', () => {
    expect(detectYamlError('---\r\ntitle: My Note\r\n---\r\n\r\n# Title')).toBeNull()
  })

  it('returns error for unclosed frontmatter', () => {
    const error = detectYamlError('---\ntitle: My Note\n\n# Title')
    expect(error).toContain('Unclosed frontmatter')
  })

  it('returns error for tab indentation in frontmatter', () => {
    const error = detectYamlError('---\n\ttitle: My Note\n---\n')
    expect(error).toContain('tab indentation')
  })

  it('returns null for content not starting with ---', () => {
    expect(detectYamlError('Not frontmatter')).toBeNull()
  })
})

describe('buildRawEditorBaseItems', () => {
  it('includes filename aliases and deduplicates entries by path', () => {
    expect(buildRawEditorBaseItems([
      {
        title: 'Project Alpha',
        aliases: ['Alpha'],
        filename: 'project-alpha.md',
        isA: 'Project',
        path: 'projects/project-alpha.md',
      },
      {
        title: 'Project Alpha',
        aliases: ['Ignored'],
        filename: 'project-alpha.md',
        isA: 'Project',
        path: 'projects/project-alpha.md',
      },
    ] as VaultEntry[])).toEqual([
      {
        title: 'Project Alpha',
        aliases: ['project-alpha', 'Alpha'],
        group: 'Project',
        entryType: 'Project',
        entryTitle: 'Project Alpha',
        path: 'projects/project-alpha.md',
      },
    ])
  })
})

describe('getRawEditorDropdownPosition', () => {
  it('renders above the cursor when there is not enough space below', () => {
    expect(getRawEditorDropdownPosition(
      { caretTop: 500, caretLeft: 900, selectedIndex: 0, items: [] },
      200,
      { innerHeight: 640, innerWidth: 1000 },
    )).toEqual({ top: 276, left: 740 })
  })
})
