import { codeBlockOptions } from '@blocknote/code-block'
import type { CodeBlockOptions } from '@blocknote/core'
import {
  canonicalKnownCodeBlockLanguage,
  codeBlockLanguageOptions,
  EXTRA_CODE_BLOCK_LANGUAGES,
  GO_CODE_BLOCK_LANGUAGE,
} from '../utils/codeBlockLanguageCatalog'
import { supportsModernRegexFeatures } from '../utils/regexCapabilities'

const LIGHT_CODE_THEME = 'github-light'
const DARK_CODE_THEME = 'github-dark'
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
type TolariaLanguageLoader = () => Promise<TolariaLanguageInput[]>
type TolariaNamedLanguageRegistration = Record<string, unknown> & {
  name: string
  displayName?: string
  aliases?: string[]
}

const GO_LANGUAGE = codeBlockLanguageOptions([GO_CODE_BLOCK_LANGUAGE]).go
const EXTRA_SUPPORTED_LANGUAGES = codeBlockLanguageOptions(EXTRA_CODE_BLOCK_LANGUAGES)

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

function languageInputs(languages: readonly TolariaLanguageInput[]): TolariaLanguageInput[] {
  return [...languages]
}

function namedLanguageRegistration(value: TolariaLanguageInput): TolariaNamedLanguageRegistration | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return typeof record.name === 'string'
    ? record as TolariaNamedLanguageRegistration
    : null
}

function renameLanguageRegistration(
  languages: readonly TolariaLanguageInput[],
  sourceName: string,
  nextLanguage: { name: string; displayName: string; aliases: string[] },
): TolariaLanguageInput[] {
  return languages.map((language) => {
    const registration = namedLanguageRegistration(language)
    if (!registration || registration.name !== sourceName) return language
    return { ...registration, ...nextLanguage } as TolariaLanguageInput
  })
}

async function loadVbScriptLanguage(): Promise<TolariaLanguageInput[]> {
  const language = await import('@shikijs/langs/vb')
  return renameLanguageRegistration(language.default, 'vb', {
    name: 'vbscript',
    displayName: 'VBScript',
    aliases: ['vb', 'vbs', 'vba', 'visual-basic', 'visualbasic'],
  })
}

const EXTRA_LANGUAGE_LOADERS = new Map<string, TolariaLanguageLoader>([
  ['powershell', async () => languageInputs((await import('@shikijs/langs/powershell')).default)],
  ['vbscript', loadVbScriptLanguage],
  ['dart', async () => languageInputs((await import('@shikijs/langs/dart')).default)],
  ['groovy', async () => languageInputs((await import('@shikijs/langs/groovy')).default)],
  ['matlab', async () => languageInputs((await import('@shikijs/langs/matlab')).default)],
  ['perl', async () => languageInputs((await import('@shikijs/langs/perl')).default)],
  ['elixir', async () => languageInputs((await import('@shikijs/langs/elixir')).default)],
  ['erlang', async () => languageInputs((await import('@shikijs/langs/erlang')).default)],
  ['fsharp', async () => languageInputs((await import('@shikijs/langs/fsharp')).default)],
  ['clojure', async () => languageInputs((await import('@shikijs/langs/clojure')).default)],
  ['asm', async () => languageInputs((await import('@shikijs/langs/asm')).default)],
  ['zig', async () => languageInputs((await import('@shikijs/langs/zig')).default)],
  ['hcl', async () => languageInputs((await import('@shikijs/langs/hcl')).default)],
  ['terraform', async () => languageInputs((await import('@shikijs/langs/terraform')).default)],
  ['dockerfile', async () => languageInputs((await import('@shikijs/langs/dockerfile')).default)],
  ['batch', async () => languageInputs((await import('@shikijs/langs/bat')).default)],
  ['diff', async () => languageInputs((await import('@shikijs/langs/diff')).default)],
  ['ini', async () => languageInputs((await import('@shikijs/langs/ini')).default)],
  ['toml', async () => languageInputs((await import('@shikijs/langs/toml')).default)],
])

function expandGoLanguage(language: string): TolariaLanguageInput[] | null {
  return canonicalKnownCodeBlockLanguage(language) === 'go'
    ? [GO_LANGUAGE_REGISTRATION as TolariaLanguageInput]
    : null
}

async function expandExternalLanguage(language: string): Promise<TolariaLanguageInput[] | null> {
  const canonicalLanguage = canonicalKnownCodeBlockLanguage(language) ?? language.trim().toLowerCase()
  const loadLanguage = EXTRA_LANGUAGE_LOADERS.get(canonicalLanguage)
  return loadLanguage ? loadLanguage() : null
}

async function expandLanguage(language: TolariaLanguageInput): Promise<TolariaLanguageInput[]> {
  if (typeof language !== 'string') return [language]
  return expandGoLanguage(language) ?? await expandExternalLanguage(language) ?? [language]
}

async function createTolariaCodeHighlighter(): Promise<TolariaCodeHighlighter> {
  const highlighter = await codeBlockOptions.createHighlighter()
  return {
    ...highlighter,
    getLoadedThemes: () => prioritizeTheme(highlighter.getLoadedThemes(), currentCodeBlockTheme()),
    loadLanguage: async (...languages) => {
      const expandedLanguages = await Promise.all(languages.map(expandLanguage))
      return highlighter.loadLanguage(...expandedLanguages.flat())
    },
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
      ...EXTRA_SUPPORTED_LANGUAGES,
    },
  }

  if (supportsModernRegexFeatures()) return options

  delete options.createHighlighter
  return options
}
