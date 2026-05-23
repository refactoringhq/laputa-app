import { codeBlockOptions } from '@blocknote/code-block'
import type { CodeBlockOptions } from '@blocknote/core'
import { supportsModernRegexFeatures } from '../utils/regexCapabilities'

const LIGHT_CODE_THEME = 'github-light'
const DARK_CODE_THEME = 'github-dark'
const GO_LANGUAGE = { name: 'Go', aliases: ['go', 'golang'] }
const GO_LANGUAGE_REGISTRATION = {
  name: 'go',
  displayName: 'Go',
  scopeName: 'source.go',
  aliases: ['golang'],
  patterns: [
    { include: '#comments' },
    { include: '#strings' },
    { include: '#keywords' },
    { include: '#numbers' },
  ],
  repository: {
    comments: {
      patterns: [
        { begin: '/\\*', end: '\\*/', name: 'comment.block.go' },
        { begin: '//', end: '$', name: 'comment.line.double-slash.go' },
      ],
    },
    keywords: {
      patterns: [
        {
          match: '\\b(break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var)\\b',
          name: 'keyword.control.go',
        },
      ],
    },
    numbers: {
      patterns: [
        { match: '\\b0[xX][0-9a-fA-F_]+\\b|\\b\\d[\\d_]*(\\.\\d[\\d_]*)?\\b', name: 'constant.numeric.go' },
      ],
    },
    strings: {
      patterns: [
        { begin: '"', end: '"', name: 'string.quoted.double.go' },
        { begin: '`', end: '`', name: 'string.quoted.raw.go' },
      ],
    },
  },
}

type TolariaCodeHighlighter = Awaited<ReturnType<NonNullable<typeof codeBlockOptions.createHighlighter>>>
type TolariaLoadLanguage = TolariaCodeHighlighter['loadLanguage']
type TolariaLanguageInput = Parameters<TolariaLoadLanguage>[number]

function currentCodeBlockTheme() {
  if (typeof document === 'undefined') return LIGHT_CODE_THEME

  const root = document.documentElement
  return root.classList.contains('dark') || root.dataset.theme === 'dark'
    ? DARK_CODE_THEME
    : LIGHT_CODE_THEME
}

function prioritizeTheme(themes: string[], theme: string) {
  return [theme, ...themes.filter((candidate) => candidate !== theme)]
}

function expandGoLanguage(language: TolariaLanguageInput): TolariaLanguageInput[] {
  if (typeof language !== 'string') return [language]
  const languageName: string = language
  return languageName === 'go' || languageName === 'golang'
    ? [GO_LANGUAGE_REGISTRATION as TolariaLanguageInput]
    : [language]
}

async function createTolariaCodeHighlighter(): Promise<TolariaCodeHighlighter> {
  const highlighter = await codeBlockOptions.createHighlighter()
  return {
    ...highlighter,
    getLoadedThemes: () => prioritizeTheme(highlighter.getLoadedThemes(), currentCodeBlockTheme()),
    loadLanguage: (...languages) => highlighter.loadLanguage(...languages.flatMap(expandGoLanguage)),
  }
}

export function createTolariaCodeBlockOptions(): Partial<CodeBlockOptions> {
  const options: Partial<CodeBlockOptions> = {
    ...codeBlockOptions,
    createHighlighter: createTolariaCodeHighlighter,
    defaultLanguage: 'text',
    supportedLanguages: {
      ...codeBlockOptions.supportedLanguages,
      go: GO_LANGUAGE,
    },
  }

  if (supportsModernRegexFeatures()) return options

  delete options.createHighlighter
  return options
}
