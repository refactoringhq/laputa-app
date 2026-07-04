import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { forceParsing, syntaxTree } from '@codemirror/language'
import { markdownLanguage } from './markdownHighlight'

function createView(doc: string) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    extensions: [markdownLanguage()],
  })
  const view = new EditorView({ state, parent })
  return { view, parent }
}

function nodeNamesAt(view: EditorView, doc: string, needle: string) {
  const pos = doc.indexOf(needle)
  expect(pos).toBeGreaterThanOrEqual(0)
  forceParsing(view, view.state.doc.length)

  const names: string[] = []
  let node = syntaxTree(view.state).resolveInner(pos + 1, 1)
  while (node) {
    names.push(node.name)
    node = node.parent
  }
  return names
}

function findLines(parent: HTMLDivElement) {
  return Array.from(parent.querySelectorAll<HTMLDivElement>('.cm-line'))
}

function expectMarkerOnlyHighlight(
  line: HTMLDivElement | undefined,
  expectedText: string,
  expectedMarker: string,
  expectedTrailingText: string,
) {
  expect(line).toBeDefined()
  expect(line!.textContent).toBe(expectedText)
  expect(Array.from(line!.querySelectorAll('span'), (span) => span.textContent)).toEqual([expectedMarker])
  expect(line!.lastChild).not.toBeNull()
  expect(line!.lastChild!.nodeType).toBe(Node.TEXT_NODE)
  expect(line!.lastChild!.textContent).toBe(expectedTrailingText)
}

describe('markdownLanguage', () => {
  it('returns a valid extension', () => {
    const ext = markdownLanguage()
    expect(ext).toBeDefined()
    expect(Array.isArray(ext)).toBe(true)
  })

  it('creates an editor without errors', () => {
    const { view, parent } = createView('# Heading\n\n**bold** and *italic*\n\n- list item')
    expect(view.state.doc.toString()).toContain('# Heading')
    view.destroy()
    parent.remove()
  })

  it('parses markdown content with mixed syntax', () => {
    const doc = [
      '# Title',
      '',
      'Some **bold** and *italic* text.',
      '',
      '- item one',
      '- item two',
      '',
      '[a link](http://example.com)',
      '',
      '> a blockquote',
      '',
      '`inline code`',
    ].join('\n')
    const { view, parent } = createView(doc)
    expect(view.state.doc.lines).toBe(12)
    view.destroy()
    parent.remove()
  })

  it('parses valid leading frontmatter as YAML instead of markdown', () => {
    const doc = [
      '---',
      '# comment',
      'title: Hello',
      'tags:',
      '  - one',
      '"Belongs to": Alpha',
      '---',
      '',
      '# Heading',
    ].join('\n')
    const { view, parent } = createView(doc)

    expect(nodeNamesAt(view, doc, '# comment')).toContain('Frontmatter')
    expect(nodeNamesAt(view, doc, '# comment')).not.toContain('ATXHeading1')
    expect(nodeNamesAt(view, doc, '- one')).toContain('Frontmatter')
    expect(nodeNamesAt(view, doc, '- one')).not.toContain('BulletList')
    expect(nodeNamesAt(view, doc, '"Belongs to"')).toContain('Frontmatter')
    expect(nodeNamesAt(view, doc, '# Heading')).toContain('ATXHeading1')
    expect(nodeNamesAt(view, doc, '# Heading')).not.toContain('Frontmatter')

    view.destroy()
    parent.remove()
  })

  it('parses fenced html block contents with HTML syntax nodes', () => {
    const doc = [
      '```html height="360"',
      '<section class="note-card">Hello</section>',
      '```',
    ].join('\n')
    const { view, parent } = createView(doc)

    expect(nodeNamesAt(view, doc, 'section')).toContain('TagName')
    expect(nodeNamesAt(view, doc, 'note-card')).toContain('AttributeValue')

    view.destroy()
    parent.remove()
  })

  it('styles only list markers while leaving list item text as plain content', async () => {
    const doc = [
      '- item one',
      '  - nested item',
      '1. ordered item',
    ].join('\n')
    const { view, parent } = createView(doc)

    forceParsing(view, view.state.doc.length)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const lines = findLines(parent)
    expect(lines).toHaveLength(3)

    expectMarkerOnlyHighlight(lines[0], '- item one', '-', ' item one')
    expectMarkerOnlyHighlight(lines[1], '  - nested item', '-', ' nested item')
    expectMarkerOnlyHighlight(lines[2], '1. ordered item', '1.', ' ordered item')

    view.destroy()
    parent.remove()
  })
})
