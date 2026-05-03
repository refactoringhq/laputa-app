import { describe, it, expect } from 'vitest'
import { preProcessWikilinks, injectWikilinks, restoreWikilinksInBlocks, splitFrontmatter, countWords, extractOutgoingLinks, extractBacklinkContext, extractSnippet } from './wikilinks'

interface TestBlock {
  type?: string
  text?: string
  content?: TestBlock[]
  children?: TestBlock[]
  props?: Record<string, string>
  href?: string
  [key: string]: unknown
}

describe('preProcessWikilinks', () => {
  it('replaces [[target]] with placeholder tokens', () => {
    const result = preProcessWikilinks('See [[My Note]] for details')
    expect(result).toContain('WIKILINK:My Note')
    expect(result).not.toContain('[[My Note]]')
  })

  it('handles aliases [[note|alias]]', () => {
    const result = preProcessWikilinks('Link to [[project/my-project|My Project]]')
    expect(result).toContain('WIKILINK:project/my-project|My Project')
  })

  it('handles multiple wikilinks', () => {
    const result = preProcessWikilinks('See [[A]] and [[B]]')
    expect(result).toContain('WIKILINK:A')
    expect(result).toContain('WIKILINK:B')
  })

  it('returns unchanged text when no wikilinks', () => {
    const input = 'No links here'
    expect(preProcessWikilinks(input)).toBe(input)
  })

  it('preserves wikilinks and inline formatting inside markdown tables', () => {
    const input = [
      '| Topic | Reference |',
      '| --- | --- |',
      '| [[Project Alpha]] | **bold** and [[Project Beta]] |',
      '',
      'Outside [[Project Gamma]]',
    ].join('\n')

    const result = preProcessWikilinks(input)

    expect(result).toContain('| [[Project Alpha]] | **bold** and [[Project Beta]] |')
    expect(result).toContain('WIKILINK:Project Gamma')
    expect(result).not.toContain('WIKILINK:Project Alpha')
    expect(result).not.toContain('WIKILINK:Project Beta')
  })

  it('handles empty string', () => {
    expect(preProcessWikilinks('')).toBe('')
  })
})

describe('injectWikilinks', () => {
  const WL_START = '\u2039WIKILINK:'
  const WL_END = '\u203A'

  it('converts placeholder text nodes into wikilink nodes', () => {
    const blocks = [{
      content: [
        { type: 'text', text: `before ${WL_START}My Note${WL_END} after` },
      ],
    }]

    const result = injectWikilinks(blocks) as TestBlock[]
    expect(result[0].content).toHaveLength(3)
    expect(result[0].content![0]).toEqual({ type: 'text', text: 'before ' })
    expect(result[0].content![1]).toEqual({
      type: 'wikilink',
      props: { target: 'My Note' },
      content: undefined,
    })
    expect(result[0].content![2]).toEqual({ type: 'text', text: ' after' })
  })

  it('handles multiple wikilinks in one text node', () => {
    const blocks = [{
      content: [
        { type: 'text', text: `${WL_START}A${WL_END} and ${WL_START}B${WL_END}` },
      ],
    }]

    const result = injectWikilinks(blocks) as TestBlock[]
    const wikilinkNodes = result[0].content!.filter((n: TestBlock) => n.type === 'wikilink')
    expect(wikilinkNodes).toHaveLength(2)
    expect(wikilinkNodes[0].props!.target).toBe('A')
    expect(wikilinkNodes[1].props!.target).toBe('B')
  })

  it('passes through non-text content items unchanged', () => {
    const blocks = [{
      content: [
        { type: 'link', text: 'some link', href: 'http://example.com' },
      ],
    }]

    const result = injectWikilinks(blocks) as TestBlock[]
    expect(result[0].content![0].type).toBe('link')
  })

  it('recursively processes children blocks', () => {
    const blocks = [{
      content: [],
      children: [{
        content: [
          { type: 'text', text: `See ${WL_START}Nested${WL_END}` },
        ],
      }],
    }]

    const result = injectWikilinks(blocks) as TestBlock[]
    const childContent = result[0].children![0].content!
    expect(childContent).toHaveLength(2)
    expect(childContent[1].type).toBe('wikilink')
    expect(childContent[1].props!.target).toBe('Nested')
  })

  it('handles blocks without content or children', () => {
    const blocks = [{ type: 'heading', props: { level: 1 } }]
    const result = injectWikilinks(blocks as unknown[]) as TestBlock[]
    expect(result).toEqual(blocks)
  })

  it('handles text node that starts with wikilink', () => {
    const blocks = [{
      content: [
        { type: 'text', text: `${WL_START}First${WL_END} text` },
      ],
    }]

    const result = injectWikilinks(blocks) as TestBlock[]
    expect(result[0].content![0].type).toBe('wikilink')
    expect(result[0].content![0].props!.target).toBe('First')
    expect(result[0].content![1].text).toBe(' text')
  })

  it('handles text node that ends with wikilink', () => {
    const blocks = [{
      content: [
        { type: 'text', text: `text ${WL_START}Last${WL_END}` },
      ],
    }]

    const result = injectWikilinks(blocks) as TestBlock[]
    expect(result[0].content![0].text).toBe('text ')
    expect(result[0].content![1].type).toBe('wikilink')
  })
})

describe('splitFrontmatter', () => {
  it('splits YAML frontmatter from body', () => {
    const content = '---\ntitle: Hello\n---\n\n# Hello\n'
    const [fm, body] = splitFrontmatter(content)
    expect(fm).toBe('---\ntitle: Hello\n---\n')
    expect(body).toBe('\n# Hello\n')
  })

  it('returns empty frontmatter when none present', () => {
    const content = '# No Frontmatter'
    const [fm, body] = splitFrontmatter(content)
    expect(fm).toBe('')
    expect(body).toBe('# No Frontmatter')
  })

  it('returns empty frontmatter when closing --- is missing', () => {
    const content = '---\ntitle: Hello\nNo closing'
    const [fm, body] = splitFrontmatter(content)
    expect(fm).toBe('')
    expect(body).toBe(content)
  })

  it('handles frontmatter followed by immediate content', () => {
    const content = '---\ntitle: Hello\n---\nContent'
    const [fm, body] = splitFrontmatter(content)
    expect(fm).toBe('---\ntitle: Hello\n---\n')
    expect(body).toBe('Content')
  })

  it('ignores dashes inside frontmatter values', () => {
    const content = '---\ntitle: "A --- B"\ntype: Note\n---\n\nBody text'
    const [fm, body] = splitFrontmatter(content)
    expect(fm).toBe('---\ntitle: "A --- B"\ntype: Note\n---\n')
    expect(body).toBe('\nBody text')
  })
})

describe('countWords', () => {
  it('counts words in body text, stripping frontmatter', () => {
    const content = '---\ntitle: Hello\n---\n\nThis is a test note with seven words.'
    expect(countWords(content)).toBe(8)
  })

  it('strips markdown formatting characters', () => {
    const content = '---\ntitle: Test\n---\n\n# Heading\n\n**bold** and *italic*'
    const count = countWords(content)
    expect(count).toBeGreaterThan(0)
  })

  it('returns 0 for empty body', () => {
    const content = '---\ntitle: Hello\n---\n'
    expect(countWords(content)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0)
  })

  it('returns 0 for content that is only frontmatter', () => {
    const content = '---\ntitle: Hello\nstatus: Active\n---\n'
    expect(countWords(content)).toBe(0)
  })

  it('handles content without frontmatter', () => {
    const content = 'Hello world this is four words plus three'
    expect(countWords(content)).toBe(8)
  })

  it('excludes long frontmatter with many keys from count', () => {
    const content = [
      '---',
      'type: Note',
      'workspace: personal',
      'notion_id: 63aeb735-e6f4-4a32-b7b6-d34276a26dee',
      'status: Active',
      'owner: Luca Rossi',
      'tags: [Tauri, React, TypeScript]',
      'belongs_to:',
      '  - "[[quarter/q1-2026]]"',
      'related_to:',
      '  - "[[topic/software-development]]"',
      '---',
      '',
      '# My Note',
      '',
      'Only these five words count.',
    ].join('\n')
    // Title "# My Note" is excluded from word count
    // Body: "Only these five words count." = 5 words
    expect(countWords(content)).toBe(5)
  })

  it('ignores frontmatter values containing dashes', () => {
    const content = [
      '---',
      'title: "Something --- More"',
      'type: Note',
      '---',
      '',
      'Body words here.',
    ].join('\n')
    expect(countWords(content)).toBe(3)
  })

  it('handles frontmatter with horizontal rule in body', () => {
    const content = [
      '---',
      'type: Note',
      '---',
      '',
      '# Title',
      '',
      'Before the rule.',
      '',
      '---',
      '',
      'After the rule.',
    ].join('\n')
    // Title "# Title" is excluded; body: Before, the, rule., After, the, rule. = 6
    expect(countWords(content)).toBe(6)
  })

  it('returns 0 when content is only frontmatter with no trailing body', () => {
    const content = '---\ntitle: Hello\nstatus: Active\ntags: [a, b, c]\n---'
    expect(countWords(content)).toBe(0)
  })

  it('excludes title heading from word count', () => {
    const content = '---\ntitle: Hello World\n---\n\n# Hello World\n\nThree body words.'
    expect(countWords(content)).toBe(3)
  })

  it('counts correctly when no title heading is present', () => {
    const content = '---\ntitle: Test\n---\n\nFour words in body.'
    expect(countWords(content)).toBe(4)
  })

  it('excludes wikilinks from word count', () => {
    const content = '---\ntitle: Test\n---\n\n# Test\n\nSee [[My Note]] for details.'
    // Title excluded, wikilink excluded: See, for, details. = 3
    expect(countWords(content)).toBe(3)
  })

  it('excludes multiple wikilinks from word count', () => {
    const content = 'Check [[note-a]] and [[note-b]] here.'
    // wikilinks excluded: Check, and, here. = 3
    expect(countWords(content)).toBe(3)
  })

  it('returns 0 for note with only title and no body', () => {
    const content = '---\ntitle: Empty\n---\n\n# Empty\n'
    expect(countWords(content)).toBe(0)
  })

  it('does not strip ## or ### subheadings as title', () => {
    const content = '---\ntitle: Test\n---\n\n## Subheading\n\nBody text here.'
    // ## is not a title heading; "Subheading" counts: Subheading, Body, text, here. = 4
    expect(countWords(content)).toBe(4)
  })
})

describe('restoreWikilinksInBlocks', () => {
  it('converts wikilink nodes back to [[target]] text', () => {
    const blocks = [{
      content: [
        { type: 'text', text: 'See ' },
        { type: 'wikilink', props: { target: 'My Note' }, content: undefined },
        { type: 'text', text: ' for details' },
      ],
    }]

    const result = restoreWikilinksInBlocks(blocks) as TestBlock[]
    expect(result[0].content).toHaveLength(3)
    expect(result[0].content![0]).toEqual({ type: 'text', text: 'See ' })
    expect(result[0].content![1]).toEqual({ type: 'text', text: '[[My Note]]' })
    expect(result[0].content![2]).toEqual({ type: 'text', text: ' for details' })
  })

  it('handles multiple wikilinks in one block', () => {
    const blocks = [{
      content: [
        { type: 'wikilink', props: { target: 'A' }, content: undefined },
        { type: 'text', text: ' and ' },
        { type: 'wikilink', props: { target: 'B' }, content: undefined },
      ],
    }]

    const result = restoreWikilinksInBlocks(blocks) as TestBlock[]
    expect(result[0].content![0]).toEqual({ type: 'text', text: '[[A]]' })
    expect(result[0].content![1]).toEqual({ type: 'text', text: ' and ' })
    expect(result[0].content![2]).toEqual({ type: 'text', text: '[[B]]' })
  })

  it('recursively processes children blocks', () => {
    const blocks = [{
      content: [],
      children: [{
        content: [
          { type: 'wikilink', props: { target: 'Nested' }, content: undefined },
        ],
      }],
    }]

    const result = restoreWikilinksInBlocks(blocks) as TestBlock[]
    expect(result[0].children![0].content![0]).toEqual({ type: 'text', text: '[[Nested]]' })
  })

  it('passes through non-wikilink content unchanged', () => {
    const blocks = [{
      content: [
        { type: 'text', text: 'plain text' },
        { type: 'link', text: 'a link', href: 'http://example.com' },
      ],
    }]

    const result = restoreWikilinksInBlocks(blocks) as TestBlock[]
    expect(result[0].content![0]).toEqual({ type: 'text', text: 'plain text' })
    expect(result[0].content![1]).toEqual({ type: 'link', text: 'a link', href: 'http://example.com' })
  })

  it('handles blocks without content', () => {
    const blocks = [{ type: 'heading', props: { level: 1 } }]
    const result = restoreWikilinksInBlocks(blocks as unknown[]) as TestBlock[]
    expect(result[0].type).toBe('heading')
  })

  it('is the inverse of injectWikilinks for simple cases', () => {
    const WL_START = '\u2039WIKILINK:'
    const WL_END = '\u203A'

    // Start with placeholder text
    const blocks = [{
      content: [
        { type: 'text', text: `before ${WL_START}Target${WL_END} after` },
      ],
    }]

    // inject → restore should produce [[Target]] text
    const injected = injectWikilinks(blocks) as TestBlock[]
    const restored = restoreWikilinksInBlocks(injected) as TestBlock[]

    // Find the text that was the wikilink
    const texts = restored[0].content!.map(n => n.text).join('')
    expect(texts).toContain('[[Target]]')
  })
})

describe('extractOutgoingLinks', () => {
  it('extracts simple wikilink targets', () => {
    const content = 'See [[My Note]] for details.'
    expect(extractOutgoingLinks(content)).toEqual(['My Note'])
  })

  it('extracts alias wikilinks (target only)', () => {
    const content = 'Link to [[project/my-project|My Project]] here.'
    expect(extractOutgoingLinks(content)).toEqual(['project/my-project'])
  })

  it('extracts multiple wikilinks sorted and deduplicated', () => {
    const content = 'See [[B]] and [[A]] and [[B]] again.'
    expect(extractOutgoingLinks(content)).toEqual(['A', 'B'])
  })

  it('returns empty array for content with no wikilinks', () => {
    expect(extractOutgoingLinks('No links here')).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(extractOutgoingLinks('')).toEqual([])
  })

  it('extracts wikilinks from frontmatter values', () => {
    const content = '---\nbelongs_to:\n  - "[[quarter/q1-2026]]"\n---\n\n# Title\n'
    expect(extractOutgoingLinks(content)).toEqual(['quarter/q1-2026'])
  })

  it('handles wikilinks in various positions', () => {
    const content = '[[First]] middle [[Second]] end [[Third]]'
    expect(extractOutgoingLinks(content)).toEqual(['First', 'Second', 'Third'])
  })

  it('ignores empty wikilinks', () => {
    const content = 'Text [[]] and [[Valid]]'
    expect(extractOutgoingLinks(content)).toEqual(['Valid'])
  })
})

describe('extractBacklinkContext', () => {
  const targets = new Set(['My Note'])

  it('extracts the paragraph containing a matching wikilink', () => {
    const content = '---\ntitle: Test\n---\n\n# Test\n\nFirst paragraph.\n\nThis references [[My Note]] in context.\n\nThird paragraph.'
    const result = extractBacklinkContext(content, targets)
    expect(result).toBe('This references [[My Note]] in context.')
  })

  it('returns null when no matching wikilink found', () => {
    const content = '---\ntitle: Test\n---\n\n# Test\n\nNo links here.'
    expect(extractBacklinkContext(content, targets)).toBeNull()
  })

  it('returns null for empty content', () => {
    expect(extractBacklinkContext('', targets)).toBeNull()
  })

  it('truncates long paragraphs with ellipsis', () => {
    const longPara = 'A'.repeat(100) + ' [[My Note]] ' + 'B'.repeat(100)
    const content = `---\ntitle: X\n---\n\n# X\n\n${longPara}`
    const result = extractBacklinkContext(content, targets, 50)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(50)
    expect(result!.endsWith('\u2026')).toBe(true)
  })

  it('matches path-based wikilinks via last segment', () => {
    const content = '---\ntitle: Test\n---\n\n# Test\n\nSee [[project/My Note]] for details.'
    const result = extractBacklinkContext(content, targets)
    expect(result).toBe('See [[project/My Note]] for details.')
  })

  it('matches aliased wikilinks [[target|display]]', () => {
    const content = '---\ntitle: Test\n---\n\n# Test\n\nCheck [[My Note|the note]] here.'
    const result = extractBacklinkContext(content, targets)
    expect(result).toBe('Check [[My Note|the note]] here.')
  })

  it('skips frontmatter and title heading', () => {
    const content = '---\ntitle: My Note\n---\n\n# My Note\n\nBody text with [[My Note]] link.'
    const result = extractBacklinkContext(content, targets)
    expect(result).toBe('Body text with [[My Note]] link.')
  })

  it('collapses internal whitespace', () => {
    const content = '---\ntitle: X\n---\n\n# X\n\nMultiple   spaces\nand newline with [[My Note]] link.'
    const result = extractBacklinkContext(content, targets)
    expect(result).toBe('Multiple spaces and newline with [[My Note]] link.')
  })

  it('returns first matching paragraph when multiple match', () => {
    const content = '---\ntitle: X\n---\n\n# X\n\nFirst [[My Note]] mention.\n\nSecond [[My Note]] mention.'
    const result = extractBacklinkContext(content, targets)
    expect(result).toBe('First [[My Note]] mention.')
  })

  it('does not return paragraph when maxLength is respected', () => {
    const content = '---\ntitle: X\n---\n\n# X\n\nShort [[My Note]].'
    const result = extractBacklinkContext(content, targets, 200)
    expect(result).toBe('Short [[My Note]].')
  })
})

describe('extractSnippet', () => {
  it('extracts first paragraph after frontmatter and title', () => {
    const content = '---\ntype: Note\n---\n\n# My Note\n\nThis is the first paragraph of content.\n\n## Section Two\n\nMore content here.'
    const snippet = extractSnippet(content)
    expect(snippet).toContain('This is the first paragraph')
    expect(snippet).toContain('More content here')
  })

  it('strips markdown formatting (bold, italic, code)', () => {
    const content = '# Title\n\nSome **bold** and *italic* and `code` text.'
    expect(extractSnippet(content)).toBe('Some bold and italic and code text.')
  })

  it('strips markdown links, keeps display text', () => {
    const content = '# Title\n\nSee [this link](https://example.com) and [[wiki link]].'
    const snippet = extractSnippet(content)
    expect(snippet).toContain('this link')
    expect(snippet).not.toContain('https://example.com')
    expect(snippet).toContain('wiki link')
    expect(snippet).not.toContain('[[')
  })

  it('uses display text from aliased wikilinks', () => {
    const content = '# Title\n\nDiscussed in [[meetings/standup|standup]] today.'
    expect(extractSnippet(content)).toBe('Discussed in standup today.')
  })

  it('truncates long content to ~160 chars with ellipsis', () => {
    const content = `# Title\n\n${'word '.repeat(100)}`
    const snippet = extractSnippet(content)
    expect(snippet.length).toBeLessThanOrEqual(165)
    expect(snippet).toMatch(/\.\.\.$/)
  })

  it('returns empty string for note with only title', () => {
    const content = '---\ntype: Note\n---\n\n# Just a Title\n'
    expect(extractSnippet(content)).toBe('')
  })

  it('skips code fence delimiters', () => {
    const content = '# Title\n\n```rust\nfn main() {}\n```\n\nReal content here.'
    const snippet = extractSnippet(content)
    expect(snippet).not.toContain('```')
    expect(snippet).toContain('Real content here')
  })

  it('falls back to sub-heading text when no paragraph content', () => {
    const content = '# Title\n\n## Section One\n\n### Sub Section\n'
    expect(extractSnippet(content)).toBe('Section One Sub Section')
  })

  it('falls back to sub-headings for headings-and-rules-only notes', () => {
    const content = '---\ntype: Project\n---\n# My Project\n\n## Description\n\n---\n\n## Key Results\n\n---\n'
    expect(extractSnippet(content)).toBe('Description Key Results')
  })

  it('prefers paragraph content over sub-heading fallback', () => {
    const content = '# Title\n\n## Section One\n\nActual paragraph content.\n\n## Section Two\n'
    expect(extractSnippet(content)).toMatch(/^Actual paragraph content/)
  })

  it('handles content without frontmatter or title', () => {
    const content = 'Just plain text content without any heading.'
    expect(extractSnippet(content)).toBe('Just plain text content without any heading.')
  })

  it('skips horizontal rules', () => {
    const content = '# Title\n\n---\n\nContent after rule.'
    expect(extractSnippet(content)).toBe('Content after rule.')
  })

  it('handles strikethrough', () => {
    const content = '# Title\n\n~~deleted~~ text remains.'
    expect(extractSnippet(content)).toBe('deleted text remains.')
  })

  it('extracts snippet from project-template note with body text', () => {
    const content = [
      '---', 'type: Project', 'status: Active', '---', '',
      '# Ship MVP of Tolaria', '',
      '## Objective', '',
      'Ship the minimum viable product for Tolaria marketplace.', '',
      '## Key Results', '',
      '- 100 beta users signed up',
    ].join('\n')
    const snippet = extractSnippet(content)
    expect(snippet).toContain('Ship the minimum viable product')
  })

  it('strips list markers from bullet items', () => {
    const content = '# Title\n\n* First bullet\n* Second bullet\n- Dash item'
    const snippet = extractSnippet(content)
    expect(snippet).toBe('First bullet Second bullet Dash item')
  })

  it('strips ordered list markers', () => {
    const content = '# Title\n\n1. First step\n2. Second step\n3. Third step'
    const snippet = extractSnippet(content)
    expect(snippet).toBe('First step Second step Third step')
  })

  it('handles mixed headings and bullet lists (real-world format)', () => {
    const content = '---\ntype: Project\nstatus: Active\n---\n# Migrate newsletter\n\n### 1) Goal one\n\n* Migration is successful\n\n### 2) Goal two\n\n* No regressions on open rate'
    const snippet = extractSnippet(content)
    expect(snippet).toMatch(/^Migration is successful/)
    expect(snippet).toContain('No regressions on open rate')
  })

  it('trims leading/trailing whitespace from snippet', () => {
    const content = '# Title\n\n  Some text with spaces  \n'
    const snippet = extractSnippet(content)
    expect(snippet).toBe('Some text with spaces')
  })

  it('includes code content lines (not fences) in snippet', () => {
    const content = '# Title\n\n```\nfn main() {}\n```\n\nSome text.'
    const snippet = extractSnippet(content)
    expect(snippet).toContain('fn main()')
    expect(snippet).toContain('Some text.')
  })
})
