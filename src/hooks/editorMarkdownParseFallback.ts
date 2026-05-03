import { normalizeParsedImageBlocks } from './editorTabContent'

type EditorBlocks = unknown[]
type ParseMarkdownBlocks = (markdown: string) => EditorBlocks | Promise<EditorBlocks>

export type MarkdownParseResult = {
  blocks: EditorBlocks
  usedSourceFallback: boolean
}

function buildSourceLineBlock(line: string): Record<string, unknown> {
  return {
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line, styles: {} }] : [],
    children: [],
  }
}

function buildMarkdownSourceBlocks(markdown: string): EditorBlocks {
  return markdown.split('\n').map(buildSourceLineBlock)
}

export async function parseMarkdownBlocksWithFallback(options: {
  parseMarkdownBlocks: ParseMarkdownBlocks
  preprocessed: string
  sourceMarkdown: string
  context: string
}): Promise<MarkdownParseResult> {
  const { parseMarkdownBlocks, preprocessed, sourceMarkdown, context } = options

  try {
    return {
      blocks: normalizeParsedImageBlocks(await parseMarkdownBlocks(preprocessed)),
      usedSourceFallback: false,
    }
  } catch (error) {
    console.warn(`[editor] Rendering ${context} as plain Markdown because BlockNote could not parse it:`, error)
    return {
      blocks: buildMarkdownSourceBlocks(sourceMarkdown),
      usedSourceFallback: true,
    }
  }
}
