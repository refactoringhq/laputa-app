import { codeBlockOptions } from '@blocknote/code-block'
import type { CodeBlockOptions } from '@blocknote/core'
import { supportsModernRegexFeatures } from '../utils/regexCapabilities'

const LIGHT_CODE_THEME = 'github-light'
const DARK_CODE_THEME = 'github-dark'

type TolariaCodeHighlighter = Awaited<ReturnType<NonNullable<typeof codeBlockOptions.createHighlighter>>>

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

async function createTolariaCodeHighlighter(): Promise<TolariaCodeHighlighter> {
  const highlighter = await codeBlockOptions.createHighlighter()
  return {
    ...highlighter,
    getLoadedThemes: () => prioritizeTheme(highlighter.getLoadedThemes(), currentCodeBlockTheme()),
  }
}

export function createTolariaCodeBlockOptions(): Partial<CodeBlockOptions> {
  const options: Partial<CodeBlockOptions> = {
    ...codeBlockOptions,
    createHighlighter: createTolariaCodeHighlighter,
    defaultLanguage: 'text',
  }

  if (supportsModernRegexFeatures()) return options

  delete options.createHighlighter
  return options
}
