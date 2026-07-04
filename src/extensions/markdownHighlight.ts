import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

const SYNTAX_COLORS = {
  atom: 'var(--syntax-highlight-number)',
  comment: 'var(--syntax-highlight-comment)',
  foreground: 'var(--text-primary)',
  heading: 'var(--syntax-heading)',
  keyword: 'var(--syntax-highlight-keyword)',
  link: 'var(--syntax-link)',
  monospace: 'var(--syntax-monospace)',
  monospaceBackground: 'var(--syntax-monospace-bg)',
  muted: 'var(--syntax-muted)',
  number: 'var(--syntax-highlight-number)',
  operator: 'var(--syntax-muted)',
  string: 'var(--syntax-highlight-string)',
  title: 'var(--syntax-highlight-title)',
  type: 'var(--syntax-highlight-type)',
}

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: SYNTAX_COLORS.heading, fontWeight: '700', fontSize: '1.4em' },
  { tag: tags.heading2, color: SYNTAX_COLORS.heading, fontWeight: '700', fontSize: '1.25em' },
  { tag: tags.heading3, color: SYNTAX_COLORS.heading, fontWeight: '600', fontSize: '1.1em' },
  { tag: tags.heading4, color: SYNTAX_COLORS.heading, fontWeight: '600' },
  { tag: tags.heading5, color: SYNTAX_COLORS.heading, fontWeight: '600' },
  { tag: tags.heading6, color: SYNTAX_COLORS.heading, fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: SYNTAX_COLORS.link, textDecoration: 'underline' },
  { tag: tags.url, color: SYNTAX_COLORS.link },
  { tag: tags.monospace, color: SYNTAX_COLORS.monospace, backgroundColor: SYNTAX_COLORS.monospaceBackground, borderRadius: '3px' },
  { tag: tags.quote, color: SYNTAX_COLORS.muted, fontStyle: 'italic' },
  { tag: tags.separator, color: SYNTAX_COLORS.muted },
  { tag: tags.processingInstruction, color: SYNTAX_COLORS.monospace, fontWeight: '600' },
  { tag: tags.contentSeparator, color: SYNTAX_COLORS.monospace, fontWeight: '600' },
  { tag: tags.comment, color: SYNTAX_COLORS.comment, fontStyle: 'italic' },
  { tag: tags.keyword, color: SYNTAX_COLORS.keyword, fontWeight: '600' },
  { tag: [tags.atom, tags.bool, tags.null], color: SYNTAX_COLORS.atom },
  { tag: tags.number, color: SYNTAX_COLORS.number },
  { tag: [tags.string, tags.special(tags.string)], color: SYNTAX_COLORS.string },
  { tag: [tags.variableName, tags.propertyName], color: SYNTAX_COLORS.foreground },
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: SYNTAX_COLORS.title },
  { tag: [tags.typeName, tags.className], color: SYNTAX_COLORS.type },
  { tag: [tags.operator, tags.punctuation], color: SYNTAX_COLORS.operator },
])

const markdownCodeLanguages = [
  LanguageDescription.of({
    name: 'html',
    alias: ['htm'],
    extensions: ['html', 'htm'],
    support: html(),
  }),
]

export function rawEditorSyntaxHighlighting(): Extension {
  return syntaxHighlighting(markdownHighlightStyle)
}

export function markdownLanguage(): Extension {
  return [
    yamlFrontmatter({ content: markdown({ codeLanguages: markdownCodeLanguages }) }),
    rawEditorSyntaxHighlighting(),
  ]
}
