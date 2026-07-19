import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { frontmatterHighlightPlugin, frontmatterHighlightTheme } from './frontmatterHighlight'

function createView(doc: string) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    extensions: [frontmatterHighlightPlugin, frontmatterHighlightTheme(false)],
  })
  const view = new EditorView({ state, parent })
  return { view, parent }
}

function errorText(parent: HTMLElement): string[] {
  return Array.from(parent.querySelectorAll('.cm-frontmatter-error'))
    .map(element => element.textContent ?? '')
}

describe('frontmatterHighlightPlugin', () => {
  it('applies delimiter class to --- lines', () => {
    const { view, parent } = createView('---\ntitle: Hello\n---\n\n# Heading')
    const delimiters = parent.querySelectorAll('.cm-frontmatter-delimiter')
    expect(delimiters.length).toBeGreaterThanOrEqual(2)
    view.destroy()
    parent.remove()
  })

  it('applies key class to YAML keys', () => {
    const { view, parent } = createView('---\ntitle: Hello\ntags: one\n---\n')
    const keys = parent.querySelectorAll('.cm-frontmatter-key')
    expect(keys.length).toBeGreaterThanOrEqual(2)
    view.destroy()
    parent.remove()
  })

  it('applies value class to YAML values', () => {
    const { view, parent } = createView('---\ntitle: Hello\n---\n')
    const values = parent.querySelectorAll('.cm-frontmatter-value')
    expect(values.length).toBeGreaterThanOrEqual(1)
    view.destroy()
    parent.remove()
  })

  it('handles content without frontmatter', () => {
    const { view, parent } = createView('# Just a heading\n\nNo frontmatter here.')
    const delimiters = parent.querySelectorAll('.cm-frontmatter-delimiter')
    expect(delimiters.length).toBe(0)
    const keys = parent.querySelectorAll('.cm-frontmatter-key')
    expect(keys.length).toBe(0)
    view.destroy()
    parent.remove()
  })

  it('decorates malformed YAML at the affected content', () => {
    const { view, parent } = createView('---\ntitle: Hello\nbroken line\n---\n')

    expect(errorText(parent)).toContain('broken line')

    view.destroy()
    parent.remove()
  })

  it('accepts nested collections, comments, flow values, and block scalars', () => {
    const yaml = [
      '---',
      'metadata:',
      '  tags:',
      '    - one',
      '    - two',
      'options: { enabled: true, count: 2 }',
      'description: |',
      '  First line',
      '  Second line',
      '# A comment',
      '',
      '---',
    ].join('\n')
    const { view, parent } = createView(yaml)

    expect(errorText(parent)).toEqual([])

    view.destroy()
    parent.remove()
  })

  it('recomputes error decorations after edits', () => {
    const { view, parent } = createView('---\ntitle: Hello\n---\n')

    view.dispatch({ changes: { from: 17, insert: 'broken line\n' } })
    expect(errorText(parent)).toContain('broken line')

    view.dispatch({ changes: { from: 17, to: 29, insert: '' } })
    expect(errorText(parent)).toEqual([])

    view.destroy()
    parent.remove()
  })
})

describe('frontmatterHighlightTheme', () => {
  it('returns an EditorView extension for light mode', () => {
    const theme = frontmatterHighlightTheme(false)
    expect(theme).toBeDefined()
  })

  it('returns an EditorView extension for dark mode', () => {
    const theme = frontmatterHighlightTheme(true)
    expect(theme).toBeDefined()
  })
})
