import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import type { Extension } from '@codemirror/state'
import { rawEditorLanguageIdForPath, type RawEditorLanguageId } from '../utils/rawEditorLanguage'
import { frontmatterHighlightPlugin, frontmatterHighlightTheme } from './frontmatterHighlight'
import { markdownLanguage, rawEditorSyntaxHighlighting } from './markdownHighlight'

function javascriptLanguage(id: RawEditorLanguageId): Extension {
  if (id === 'typescript') return javascript({ typescript: true })
  if (id === 'tsx') return javascript({ jsx: true, typescript: true })
  if (id === 'jsx') return javascript({ jsx: true })
  return javascript()
}

function highlighted(language: Extension): Extension[] {
  return [language, rawEditorSyntaxHighlighting()]
}

const LANGUAGE_EXTENSIONS: Record<RawEditorLanguageId, () => Extension[]> = {
  javascript: () => highlighted(javascriptLanguage('javascript')),
  json: () => highlighted(json()),
  jsx: () => highlighted(javascriptLanguage('jsx')),
  markdown: () => [markdownLanguage(), frontmatterHighlightTheme(), frontmatterHighlightPlugin],
  plain: () => [],
  python: () => highlighted(python()),
  sql: () => highlighted(sql()),
  tsx: () => highlighted(javascriptLanguage('tsx')),
  typescript: () => highlighted(javascriptLanguage('typescript')),
  yaml: () => highlighted(yaml()),
}

function rawEditorLanguage(id: RawEditorLanguageId): Extension[] {
  return LANGUAGE_EXTENSIONS[id]()
}

export function rawEditorLanguageExtensionsForPath(path?: string | null): Extension[] {
  return rawEditorLanguage(rawEditorLanguageIdForPath(path))
}
