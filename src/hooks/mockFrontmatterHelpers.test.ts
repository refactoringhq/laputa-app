import { describe, it, expect, beforeEach } from 'vitest'
import { updateMockFrontmatter, deleteMockFrontmatterProperty } from './mockFrontmatterHelpers'

// Setup window.__mockContent for tests
declare global {
  interface Window {
    __mockContent?: Record<string, string>
  }
}

describe('mockFrontmatterHelpers', () => {
  beforeEach(() => {
    window.__mockContent = {}
  })

  function frontmatterDelimiterLineCount(content: string): number {
    return content.split(/\r?\n/).filter((line) => line === '---').length
  }

  describe('updateMockFrontmatter', () => {
    it('updates an existing string property', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\nstatus: Active\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'status', 'Done')
      expect(result).toContain('status: Done')
      expect(result).toContain('title: Hello')
      expect(result).toContain('# Hello')
    })

    it('adds a new property when key does not exist', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'owner', 'Luca')
      expect(result).toContain('owner: Luca')
      expect(result).toContain('title: Hello')
    })

    it('handles boolean value (true)', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'archived', true)
      expect(result).toContain('archived: true')
    })

    it('handles boolean value (false)', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\narchived: true\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'archived', false)
      expect(result).toContain('archived: false')
    })

    it('handles array values', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'aliases', ['ML', 'AI'])
      expect(result).toContain('aliases:')
      expect(result).toContain('  - "ML"')
      expect(result).toContain('  - "AI"')
    })

    it('replaces existing array property', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\naliases:\n  - "old"\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'aliases', ['new1', 'new2'])
      expect(result).toContain('  - "new1"')
      expect(result).toContain('  - "new2"')
      expect(result).not.toContain('"old"')
    })

    it('handles numeric value', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'order', 3)
      expect(result).toContain('_order: 3')
    })

    it('creates frontmatter when none exists', () => {
      window.__mockContent = {
        '/test.md': '# Just content',
      }

      const result = updateMockFrontmatter('/test.md', 'title', 'Hello')
      expect(result).toMatch(/^---\n/)
      expect(result).toContain('title: Hello')
      expect(result).toContain('# Just content')
    })

    it('handles empty content gracefully', () => {
      window.__mockContent = {}

      const result = updateMockFrontmatter('/test.md', 'title', 'New')
      expect(result).toContain('title: New')
    })

    it('handles keys with spaces', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'Belongs to', '[[Project A]]')
      expect(result).toContain('"Belongs to": [[Project A]]')
    })

    it('handles null value', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\n---\n',
      }

      const result = updateMockFrontmatter('/test.md', 'status', null)
      expect(result).toContain('status: null')
    })

    it('canonicalizes Type to lowercase type', () => {
      window.__mockContent = {
        '/test.md': '---\nType: Note\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'type', 'Project')
      expect(result).toContain('type: Project')
      expect(result).not.toContain('Type: Note')
    })

    it('canonicalizes legacy type aliases to lowercase type', () => {
      window.__mockContent = {
        '/test.md': '---\n"Is A": Note\nis_a: Topic\n---\n\n# Hello\n',
      }

      const result = updateMockFrontmatter('/test.md', 'type', 'Project')
      expect(result).toContain('type: Project')
      expect(result).not.toContain('"Is A": Note')
      expect(result).not.toContain('is_a: Topic')
    })

    it('canonicalizes system metadata aliases when updating mock frontmatter', () => {
      window.__mockContent = {
        '/test.md': '---\nsidebar label: Projects\nsidebar_label: Legacy\narchived: false\n---\n\n# Hello\n',
      }

      const withLabel = updateMockFrontmatter('/test.md', '_sidebar_label', 'Programs')
      window.__mockContent['/test.md'] = withLabel
      const result = updateMockFrontmatter('/test.md', '_archived', true)

      expect(result).toContain('_sidebar_label: Programs')
      expect(result).toContain('_archived: true')
      expect(result).not.toContain('sidebar label: Projects')
      expect(result).not.toContain('sidebar_label: Legacy')
      expect(result).not.toContain('archived: false')
    })

    it('updates existing CRLF frontmatter without adding a second block', () => {
      window.__mockContent = {
        '/test.md': [
          '---',
          'type: Note',
          'related_to: "[[Alpha Project]]"',
          '---',
          '# CRLF Inbox Syntax',
          '',
        ].join('\r\n'),
      }

      const result = updateMockFrontmatter('/test.md', '_organized', true)

      expect(frontmatterDelimiterLineCount(result)).toBe(2)
      expect(result).toContain('type: Note\r\n')
      expect(result).toContain('related_to: "[[Alpha Project]]"\r\n')
      expect(result).toContain('_organized: true\r\n')
      expect(result).toContain('\r\n---\r\n# CRLF Inbox Syntax')
    })
  })

  describe('deleteMockFrontmatterProperty', () => {
    it('removes an existing property', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\nstatus: Active\n---\n\n# Hello\n',
      }

      const result = deleteMockFrontmatterProperty('/test.md', 'status')
      expect(result).not.toContain('status:')
      expect(result).toContain('title: Hello')
    })

    it('removes an array property with all its items', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\naliases:\n  - "A"\n  - "B"\nstatus: Active\n---\n\n# Hello\n',
      }

      const result = deleteMockFrontmatterProperty('/test.md', 'aliases')
      expect(result).not.toContain('aliases:')
      expect(result).not.toContain('  - "A"')
      expect(result).toContain('status: Active')
    })

    it('returns content unchanged when no frontmatter', () => {
      window.__mockContent = {
        '/test.md': '# Just content',
      }

      const result = deleteMockFrontmatterProperty('/test.md', 'status')
      expect(result).toBe('# Just content')
    })

    it('returns content unchanged when key not found', () => {
      window.__mockContent = {
        '/test.md': '---\ntitle: Hello\n---\n\n# Hello\n',
      }

      const result = deleteMockFrontmatterProperty('/test.md', 'nonexistent')
      expect(result).toContain('title: Hello')
    })

    it('handles empty content', () => {
      window.__mockContent = {}

      const result = deleteMockFrontmatterProperty('/test.md', 'status')
      expect(result).toBe('')
    })

    it('deletes Type through lowercase type', () => {
      window.__mockContent = {
        '/test.md': '---\nType: Note\nstatus: Active\n---\n\n# Hello\n',
      }

      const result = deleteMockFrontmatterProperty('/test.md', 'type')
      expect(result).not.toContain('Type: Note')
      expect(result).toContain('status: Active')
    })

    it('deletes legacy aliases through canonical keys', () => {
      window.__mockContent = {
        '/test.md': '---\n"Is A": Note\nis_a: Topic\n_sidebar_label: Projects\nsidebar_label: Legacy\narchived: true\n---\n\n# Hello\n',
      }

      const withoutType = deleteMockFrontmatterProperty('/test.md', 'type')
      window.__mockContent['/test.md'] = withoutType
      const withoutLabel = deleteMockFrontmatterProperty('/test.md', '_sidebar_label')
      window.__mockContent['/test.md'] = withoutLabel
      const result = deleteMockFrontmatterProperty('/test.md', '_archived')

      expect(result).not.toContain('"Is A": Note')
      expect(result).not.toContain('is_a: Topic')
      expect(result).not.toContain('_sidebar_label: Projects')
      expect(result).not.toContain('sidebar_label: Legacy')
      expect(result).not.toContain('archived: true')
      expect(result).toContain('# Hello')
    })
  })
})
