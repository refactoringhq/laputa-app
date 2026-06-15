type PasteHandlerOptions = {
  plainTextAsMarkdown?: boolean
  prioritizeMarkdownOverHTML?: boolean
}

type PlainTextPasteEditor = {
  pasteText: (text: string) => boolean | undefined
}

export type RichEditorPasteContext = {
  defaultPasteHandler: (options?: PasteHandlerOptions) => boolean | undefined
  editor: PlainTextPasteEditor
  event: ClipboardEvent
}

const EXPLICIT_MARKDOWN_TYPES = new Set(['blocknote/html', 'text/markdown'])
const SPACED_LITERAL_ASTERISK_RE = /\S\s+\*\s+\S/u
const PREFIX_GLOB_ASTERISK_RE = /(?:^|\s)\*(?![*\s])[\w./-]+(?=\s|$)/u
const SUFFIX_GLOB_ASTERISK_RE = /(?:^|\s)[\w./-]+\*(?=\s|$)/u

function hasExplicitMarkdownPayload(clipboardData: DataTransfer): boolean {
  return Array.from(clipboardData.types).some(type => EXPLICIT_MARKDOWN_TYPES.has(type))
}

function shouldPasteAsteriskTextLiterally(text: string): boolean {
  return SPACED_LITERAL_ASTERISK_RE.test(text)
    || PREFIX_GLOB_ASTERISK_RE.test(text)
    || SUFFIX_GLOB_ASTERISK_RE.test(text)
}

function literalAsteriskPlainText(clipboardData: DataTransfer | null): string | null {
  if (!clipboardData) return null

  const plainText = clipboardData.getData('text/plain')
  if (plainText.length === 0) return null
  if (hasExplicitMarkdownPayload(clipboardData)) return null
  if (!shouldPasteAsteriskTextLiterally(plainText)) return null

  return plainText
}

export function handleRichEditorPaste({
  defaultPasteHandler,
  editor,
  event,
}: RichEditorPasteContext): boolean | undefined {
  const plainText = literalAsteriskPlainText(event.clipboardData)
  if (plainText) return editor.pasteText(plainText)

  return defaultPasteHandler()
}
