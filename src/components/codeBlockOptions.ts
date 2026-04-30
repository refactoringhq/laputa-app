import { codeBlockOptions } from '@blocknote/code-block'
import type { CodeBlockOptions } from '@blocknote/core'

function supportsShikiPrecompiledRegexFlags() {
  try {
    new RegExp('', 'd')
    new RegExp('[[]]', 'v')
    return true
  } catch {
    return false
  }
}

export function createTolariaCodeBlockOptions(): Partial<CodeBlockOptions> {
  const options: Partial<CodeBlockOptions> = {
    ...codeBlockOptions,
    defaultLanguage: 'text',
  }

  if (supportsShikiPrecompiledRegexFlags()) return options

  delete options.createHighlighter
  return options
}
