import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { preProcessHtmlTables } from '../utils/htmlTableMarkdown'
import { schema } from './editorSchema'

const HTML_TABLE_MARKDOWN = [
  '<table>',
  '  <thead>',
  '    <tr><th>Bezeichnung</th><th>M/K</th><th>Format</th><th>Anmerkung</th></tr>',
  '  </thead>',
  '  <tbody>',
  '    <tr><td>Dokumentennummer</td><td>M</td><td>an..35</td><td>eindeutige Identifikation der Nachricht</td></tr>',
  '    <tr><td>Dokumentendatum</td><td>M</td><td>n8</td><td>YYYYMMDD</td></tr>',
  '  </tbody>',
  '</table>',
  '',
].join('\n')

function createTestEditor() {
  return BlockNoteEditor.create({ schema, tables: { headers: true } })
}

describe('HTML <table> round-trip via BlockNote', () => {
  it('parses preprocessed HTML tables as native BlockNote table blocks', async () => {
    const editor = createTestEditor()
    const preprocessed = preProcessHtmlTables(HTML_TABLE_MARKDOWN)

    const blocks = await editor.tryParseMarkdownToBlocks(preprocessed)
    const tableBlock = blocks.find(block => block.type === 'table')

    expect(tableBlock).toBeDefined()
    expect(tableBlock).toMatchObject({ type: 'table' })
  })

  it('marks the first row of the parsed GFM table as a header (headerRows: 1)', async () => {
    const editor = createTestEditor()
    const preprocessed = preProcessHtmlTables(HTML_TABLE_MARKDOWN)

    const blocks = await editor.tryParseMarkdownToBlocks(preprocessed)
    const tableBlock = blocks.find(block => block.type === 'table') as { content?: { headerRows?: number } } | undefined

    expect(tableBlock?.content?.headerRows).toBe(1)
  })

  it('serializes the resulting blocks back to GFM markdown without any <table> HTML', async () => {
    const editor = createTestEditor()
    const preprocessed = preProcessHtmlTables(HTML_TABLE_MARKDOWN)

    const blocks = await editor.tryParseMarkdownToBlocks(preprocessed)
    const serialized = await editor.blocksToMarkdownLossy(blocks)

    expect(serialized).not.toContain('<table>')
    expect(serialized).not.toContain('<thead>')
    expect(serialized).not.toContain('<tbody>')
    expect(serialized).toContain('Bezeichnung')
    expect(serialized).toContain('Dokumentennummer')
  })
})
