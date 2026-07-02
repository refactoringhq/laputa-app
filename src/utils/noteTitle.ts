import { parseFrontmatter } from './frontmatter'
import { splitFrontmatter } from './wikilinks'

type DisplayTitle = string
type MarkdownContent = string
type MarkdownLine = string
type NoteFilename = string

interface ResolvedContentTitle {
  source: 'h1' | 'frontmatter'
  title: DisplayTitle
}

interface DisplayTitleInput {
  content: MarkdownContent
  filename: NoteFilename
  frontmatterTitle?: DisplayTitle | null
}

interface DisplayTitleState {
  title: DisplayTitle
  hasH1: boolean
}

function replaceWikilinkAliases(text: MarkdownLine): MarkdownLine {
  return text.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1')
}

function replacePlainWikilinks(text: MarkdownLine): MarkdownLine {
  return text.replace(/\[\[([^\]]+)\]\]/g, '$1')
}

function replaceMarkdownLinks(text: MarkdownLine): MarkdownLine {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
}

function removeInlineMarkdownMarkers(text: MarkdownLine): MarkdownLine {
  return text.replace(/[*_`~]/g, '')
}

function stripMarkdownFormatting(text: MarkdownLine): DisplayTitle {
  return removeInlineMarkdownMarkers(
    replaceMarkdownLinks(
      replacePlainWikilinks(
        replaceWikilinkAliases(text),
      ),
    ),
  )
}

function firstNonBlankLine(body: MarkdownContent): MarkdownLine | null {
  let start = 0

  while (start <= body.length) {
    const end = body.indexOf('\n', start)
    const lineEnd = end === -1 ? body.length : end
    const line = body.slice(start, lineEnd).trim()
    if (line) return line
    if (end === -1) return null
    start = end + 1
  }

  return null
}

export function filenameStemToTitle(filename: NoteFilename): DisplayTitle {
  const stem = filename.replace(/\.[^.]+$/, '')
  return stem
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function extractH1TitleFromContent(content: MarkdownContent): DisplayTitle | null {
  const [, body] = splitFrontmatter(content)
  const firstLine = firstNonBlankLine(body)

  if (!firstLine?.startsWith('# ')) return null
  const title = stripMarkdownFormatting(firstLine.slice(2)).trim()
  return title || null
}

export function extractFrontmatterTitleFromContent(content: MarkdownContent): DisplayTitle | null {
  const title = parseFrontmatter(content).title
  if (typeof title !== 'string') return null
  const trimmed = title.trim()
  return trimmed || null
}

function resolveContentTitle(
  content: MarkdownContent,
  frontmatterTitle?: DisplayTitle | null,
): ResolvedContentTitle | null {
  const h1Title = extractH1TitleFromContent(content)
  if (h1Title) {
    return { title: h1Title, source: 'h1' }
  }

  const resolvedFrontmatterTitle = frontmatterTitle?.trim() || extractFrontmatterTitleFromContent(content)
  if (resolvedFrontmatterTitle) {
    return { title: resolvedFrontmatterTitle, source: 'frontmatter' }
  }

  return null
}

export function contentDefinesDisplayTitle(content: MarkdownContent): boolean {
  return resolveContentTitle(content) !== null
}

export function deriveDisplayTitleState({
  content,
  filename,
  frontmatterTitle,
}: DisplayTitleInput): DisplayTitleState {
  const resolvedTitle = resolveContentTitle(content, frontmatterTitle)
  if (resolvedTitle) {
    return {
      title: resolvedTitle.title,
      hasH1: resolvedTitle.source === 'h1',
    }
  }

  return {
    title: filenameStemToTitle(filename),
    hasH1: false,
  }
}
