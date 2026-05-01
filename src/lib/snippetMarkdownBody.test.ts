import { describe, expect, it } from 'vitest'
import { markdownBodyText, TABLE_SNIPPET_FALLBACK } from './snippetMarkdownBody'

describe('markdownBodyText', () => {
  describe('GFM pipe tables', () => {
    it('renders a header preview of the first row with column separators', () => {
      const input = '| col1 | col2 |\n| --- | --- |\n| a | b |\n| c | d |'
      expect(markdownBodyText(input)).toBe('📊 col1 · col2')
    })

    it('uses the row above the separator as the header even with `:---:` alignment', () => {
      const input = '| Name | Status |\n| :--- | ---: |\n| Alpha | Active |'
      expect(markdownBodyText(input)).toBe('📊 Name · Status')
    })

    it('emits one marker per table block, separating prose with newlines', () => {
      const input = 'Intro line.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nOutro line.'
      expect(markdownBodyText(input)).toBe('Intro line.\n📊 a · b\nOutro line.')
    })

    it('truncates long header rows to 80 chars of header text with an ellipsis', () => {
      const longHeader = '| ' + Array.from({ length: 12 }, (_, i) => `column${i + 1}`).join(' | ') + ' |'
      const result = markdownBodyText(`${longHeader}\n| --- |\n| v |`)
      const headerText = result.replace(/^📊 /, '')
      expect(result.startsWith('📊 ')).toBe(true)
      expect(headerText.length).toBeLessThanOrEqual(80)
      expect(result.endsWith('…')).toBe(true)
    })
  })

  describe('HTML tables', () => {
    it('renders a header preview from <thead><th> cells', () => {
      const input = '<table>\n  <thead><tr><th>Bezeichnung</th><th>M/K</th><th>Format</th></tr></thead>\n  <tbody><tr><td>Doc</td><td>M</td><td>an..35</td></tr></tbody>\n</table>'
      expect(markdownBodyText(input)).toBe('📊 Bezeichnung · M/K · Format')
    })

    it('uses the first <tr> when no <thead> is present', () => {
      const input = '<table><tr><td>Alpha</td><td>Beta</td></tr><tr><td>1</td><td>2</td></tr></table>'
      expect(markdownBodyText(input)).toBe('📊 Alpha · Beta')
    })

    it('falls back to the static marker when no header cells are recoverable', () => {
      const input = '<table></table>'
      expect(markdownBodyText(input)).toBe(TABLE_SNIPPET_FALLBACK)
    })

    it('keeps surrounding paragraphs and emits one marker on its own line', () => {
      const input = 'Intro paragraph.\n\n<table><tr><th>x</th><th>y</th></tr></table>\n\nOutro paragraph.'
      expect(markdownBodyText(input)).toBe('Intro paragraph.\n📊 x · y\nOutro paragraph.')
    })
  })

  describe('non-table content', () => {
    it('drops headings and code fences', () => {
      const input = '# Title\n\nFirst paragraph.\n\n## Section\n\n```ts\nconst x = 1\n```\n\nSecond paragraph.'
      expect(markdownBodyText(input)).toBe('First paragraph. const x = 1 Second paragraph.')
    })

    it('strips inline HTML elements from prose', () => {
      const input = 'Hello <span class="x">world</span> and <em>everyone</em>.'
      expect(markdownBodyText(input)).toBe('Hello world and everyone.')
    })

    it('handles CRLF line endings', () => {
      const input = '# T\r\n\r\n| col |\r\n| --- |\r\n| val |\r\n'
      expect(markdownBodyText(input)).toBe('📊 col')
    })

    it('preserves a literal `<` followed by space in prose', () => {
      const input = 'Note: when x < y the alarm triggers.'
      expect(markdownBodyText(input)).toContain('x < y')
    })
  })
})
