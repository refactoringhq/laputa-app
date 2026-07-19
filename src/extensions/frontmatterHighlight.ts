import { ViewPlugin, Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { yamlLanguage } from '@codemirror/lang-yaml'
import type { Range } from '@codemirror/state'

const frontmatterDelimiter = Decoration.mark({ class: 'cm-frontmatter-delimiter' })
const frontmatterKey = Decoration.mark({ class: 'cm-frontmatter-key' })
const frontmatterValue = Decoration.mark({ class: 'cm-frontmatter-value' })
const frontmatterError = Decoration.mark({ class: 'cm-frontmatter-error' })

function findFrontmatterEnd(doc: { lines: number; line(n: number): { text: string } }): number {
  if (doc.lines < 1) return -1
  const first = doc.line(1).text
  if (first !== '---') return -1
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text === '---') return i
  }
  return -1
}

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const doc = view.state.doc
  const fmEnd = findFrontmatterEnd(doc)
  if (fmEnd === -1) return Decoration.none

  for (let i = 1; i <= fmEnd; i++) {
    const line = doc.line(i)
    const text = line.text

    decorateFrontmatterLine(decorations, line.from, text, i === 1 || i === fmEnd)
  }

  decorateYamlErrors(decorations, view, fmEnd)
  return Decoration.set(decorations, true)
}

function decorateFrontmatterLine(
  decorations: Range<Decoration>[],
  from: number,
  text: string,
  isDelimiter: boolean,
): void {
  if (text.length === 0) return

  if (isDelimiter) {
    decorations.push(frontmatterDelimiter.range(from, from + text.length))
    return
  }

  const colonIdx = text.indexOf(':')
  if (colonIdx > 0) {
    decorations.push(frontmatterKey.range(from, from + colonIdx))
    const valueStart = colonIdx + 1
    const valuePart = text.slice(valueStart).trimStart()
    if (valuePart.length > 0) {
      const valueOffset = text.indexOf(valuePart, valueStart)
      decorations.push(frontmatterValue.range(from + valueOffset, from + text.length))
    }
  }
}

function decorateYamlErrors(
  decorations: Range<Decoration>[],
  view: EditorView,
  frontmatterEndLine: number,
): void {
  if (frontmatterEndLine <= 2) return
  const doc = view.state.doc
  const bodyFrom = doc.line(2).from
  const bodyTo = doc.line(frontmatterEndLine - 1).to
  const source = doc.sliceString(bodyFrom, bodyTo)
  const cursor = yamlLanguage.parser.parse(source).cursor()
  const seen = new Set<string>()

  do {
    if (!cursor.type.isError) continue
    const absoluteFrom = bodyFrom + cursor.from
    const absoluteTo = bodyFrom + cursor.to
    const affectedLine = doc.lineAt(absoluteFrom)
    const from = absoluteFrom === absoluteTo ? affectedLine.from : absoluteFrom
    const to = absoluteFrom === absoluteTo ? affectedLine.to : absoluteTo
    if (from === to || to > bodyTo) continue
    const key = `${from}:${to}`
    if (seen.has(key)) continue
    seen.add(key)
    decorations.push(frontmatterError.range(from, to))
  } while (cursor.next())
}

export const frontmatterHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
      if (update.docChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

export function frontmatterHighlightTheme() {
  return EditorView.baseTheme({
    '.cm-frontmatter-delimiter': { color: 'var(--syntax-frontmatter-key)', fontWeight: '600' },
    '.cm-frontmatter-key': { color: 'var(--syntax-frontmatter-key)' },
    '.cm-frontmatter-value': { color: 'var(--syntax-frontmatter-value)' },
    '.cm-frontmatter-error': {
      backgroundColor: 'var(--feedback-error-bg)',
      textDecoration: 'underline wavy var(--feedback-error-text)',
      textDecorationSkipInk: 'none',
    },
  })
}
