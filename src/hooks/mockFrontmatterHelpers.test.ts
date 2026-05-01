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
      expect(result).toContain('order: 3')
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
  })
})
