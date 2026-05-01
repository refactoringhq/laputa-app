import { describe, it, expect } from 'vitest'
import { preProcessHtmlTables } from './htmlTableMarkdown'

const ISSUE_452_INPUT = `# 1. Inhalte der Nachricht

## 1.1. Kopfteil der Nachricht

<table>
  <thead>
    <tr>
      <th>Bezeichnung</th>
      <th>M/K</th>
      <th>Format</th>
      <th>Anmerkung</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Dokumentennummer</td>
      <td>M</td>
      <td>an..35</td>
      <td>eindeutige Identifikation der Nachricht</td>
    </tr>
    <tr>
      <td>Dokumentendatum</td>
      <td>M</td>
      <td>n8</td>
      <td>YYYYMMDD</td>
    </tr>
  </tbody>
</table>
`

describe('preProcessHtmlTables', () => {
  describe('V1: block-level <table> → GFM table', () => {
    it('converts the issue #452 minimal repro to a GFM pipe table', () => {
      const result = preProcessHtmlTables(ISSUE_452_INPUT)
      expect(result).toContain('| Bezeichnung | M/K | Format | Anmerkung |')
      expect(result).toContain('| --- | --- | --- | --- |')
      expect(result).toContain('| Dokumentennummer | M | an..35 | eindeutige Identifikation der Nachricht |')
      expect(result).toContain('| Dokumentendatum | M | n8 | YYYYMMDD |')
      expect(result).not.toContain('<table>')
      expect(result).not.toContain('<thead>')
      expect(result).not.toContain('<tbody>')
    })

    it('preserves surrounding markdown headings and paragraphs verbatim', () => {
      const result = preProcessHtmlTables(ISSUE_452_INPUT)
      expect(result).toContain('# 1. Inhalte der Nachricht')
      expect(result).toContain('## 1.1. Kopfteil der Nachricht')
    })

    it('returns input unchanged when no <table> block is present', () => {
      const input = '# Title\n\nJust text.\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })
  })

  describe('V2: <table> inside fenced code → not converted', () => {
    it('leaves a <table> inside a triple-backtick fence untouched', () => {
      const input = '# T\n\n```html\n<table><tr><td>x</td></tr></table>\n```\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })

    it('leaves a <table> inside a tilde fence untouched', () => {
      const input = '# T\n\n~~~\n<table><tr><td>x</td></tr></table>\n~~~\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })

    it('converts only the <table> outside the fence when both exist', () => {
      const input = [
        '```',
        '<table><tr><td>fenced</td></tr></table>',
        '```',
        '',
        '<table>',
        '  <tr><td>open</td></tr>',
        '</table>',
        '',
      ].join('\n')
      const result = preProcessHtmlTables(input)
      expect(result).toContain('<table><tr><td>fenced</td></tr></table>')
      expect(result).toContain('| open |')
    })
  })

  describe('V3: <table> inside inline code → not converted', () => {
    it('leaves an inline-code reference to <table> untouched', () => {
      const input = 'See `<table>` for details.\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })
  })

  describe('V4: malformed <table> → input unchanged', () => {
    it('returns input unchanged when </table> is missing', () => {
      const input = '<table>\n  <tr><td>x</td></tr>\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })

    it('returns input unchanged when the table has colspan > 1', () => {
      const input = '<table><tr><th colspan="2">spanned</th></tr><tr><td>a</td><td>b</td></tr></table>\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })

    it('returns input unchanged when the table has rowspan > 1', () => {
      const input = '<table><tr><th rowspan="2">spanned</th><th>x</th></tr><tr><td>y</td></tr></table>\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })

    it('returns input unchanged when the table has zero rows', () => {
      const input = '<table></table>\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })
  })

  describe('V5: pipe characters in cells → escaped', () => {
    it('escapes a literal pipe in a cell as \\|', () => {
      const input = '<table><tr><th>head</th></tr><tr><td>a | b</td></tr></table>\n'
      const result = preProcessHtmlTables(input)
      expect(result).toContain('| a \\| b |')
    })
  })

  describe('V6: <br> and newlines in cells → <br>', () => {
    it('converts a <br> in a cell to a literal <br> in GFM output', () => {
      const input = '<table><tr><th>head</th></tr><tr><td>line1<br>line2</td></tr></table>\n'
      const result = preProcessHtmlTables(input)
      expect(result).toContain('| line1<br>line2 |')
    })

    it('converts cell newlines to <br>', () => {
      const input = '<table><tr><th>head</th></tr><tr><td>line1\nline2</td></tr></table>\n'
      const result = preProcessHtmlTables(input)
      expect(result).toContain('| line1<br>line2 |')
    })
  })

  describe('V7: missing <thead> → first <tr> promoted', () => {
    it('uses the first <tbody> row as the header when <thead> is absent', () => {
      const input = '<table><tbody><tr><td>h1</td><td>h2</td></tr><tr><td>b1</td><td>b2</td></tr></tbody></table>\n'
      const result = preProcessHtmlTables(input)
      expect(result).toContain('| h1 | h2 |')
      expect(result).toContain('| --- | --- |')
      expect(result).toContain('| b1 | b2 |')
    })

    it('uses the first direct <tr> as the header when no thead/tbody exist', () => {
      const input = '<table><tr><td>h1</td><td>h2</td></tr><tr><td>b1</td><td>b2</td></tr></table>\n'
      const result = preProcessHtmlTables(input)
      expect(result).toContain('| h1 | h2 |')
      expect(result).toContain('| b1 | b2 |')
    })
  })

  describe('V10: existing GFM tables → not touched', () => {
    it('leaves a pipe-syntax markdown table unchanged', () => {
      const input = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })
  })

  describe('V11: non-table HTML → not touched', () => {
    it('leaves <div> blocks unchanged', () => {
      const input = '<div class="x">hello</div>\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })

    it('leaves <span> spans unchanged', () => {
      const input = 'inline <span>x</span> text\n'
      expect(preProcessHtmlTables(input)).toBe(input)
    })
  })

  describe('layout: GFM block boundaries', () => {
    it('surrounds the converted table with blank lines so markdown parsers treat it as a block', () => {
      const input = 'before\n<table><tr><th>h</th></tr><tr><td>v</td></tr></table>\nafter\n'
      const result = preProcessHtmlTables(input)
      expect(result).toMatch(/before\n\n\| h \|\n\| --- \|\n\| v \|\n\nafter/)
    })

    it('decodes HTML entities in cell text', () => {
      const input = '<table><tr><th>head</th></tr><tr><td>a &amp; b</td></tr></table>\n'
      const result = preProcessHtmlTables(input)
      expect(result).toContain('| a & b |')
    })

    it('treats <th> rows in <tbody> as cells without losing them', () => {
      const input = '<table><tbody><tr><th>h1</th><th>h2</th></tr><tr><td>b1</td><td>b2</td></tr></tbody></table>\n'
      const result = preProcessHtmlTables(input)
      expect(result).toContain('| h1 | h2 |')
      expect(result).toContain('| b1 | b2 |')
    })
  })
})
