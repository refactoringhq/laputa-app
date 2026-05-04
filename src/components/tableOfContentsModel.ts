type TocLevel = 1 | 2 | 3

interface TocInlineText {
  type?: string
  text?: string
}

interface TocBlock {
  id?: string
  type?: string
  props?: { level?: number }
  content?: TocInlineText[]
}

interface MarkdownHeading {
  blockId?: string
  level: TocLevel
  title: string
}

interface HeadingTitlePair {
  entryTitle: string
  title: string
}

interface DuplicateHeadingCheck extends HeadingTitlePair {
  headingIndex: number
  level: TocLevel
}

interface VisibleHeadings {
  headings: MarkdownHeading[]
  titleBlockId?: string
}

interface HeadingBlockMatch {
  blocks: unknown[]
  entryTitle: string
  headings: MarkdownHeading[]
}

export interface TocItem {
  blockId?: string
  children: TocItem[]
  id: string
  level: TocLevel
  matchIndex?: number
  title: string
}

function isTocLevel(value: number | undefined): value is TocLevel {
  return value === 1 || value === 2 || value === 3
}

function headingText(block: TocBlock): string {
  if (!Array.isArray(block.content)) return ''
  return block.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('')
    .trim()
}

function normalizeHeadingTitle({ title }: { title: string }): string {
  return title.trim().replace(/\s+/g, ' ')
}

function sameHeadingTitle({ entryTitle, title }: HeadingTitlePair): boolean {
  return normalizeHeadingTitle({ title }) === normalizeHeadingTitle({ title: entryTitle })
}

function isHeadingBlock(block: unknown): block is TocBlock {
  return typeof block === 'object'
    && block !== null
    && !Array.isArray(block)
    && (block as TocBlock).type === 'heading'
    && isTocLevel((block as TocBlock).props?.level)
}

function tocLevelForBlock(block: TocBlock): TocLevel | null {
  const level = block.props?.level
  return isTocLevel(level) ? level : null
}

function nearestParent(stack: TocItem[], level: TocLevel): TocItem {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const item = stack[index]
    if (item && item.level < level) return item
  }
  return stack[0]
}

function appendTocHeading(stack: TocItem[], item: TocItem) {
  const parent = nearestParent(stack, item.level)
  parent.children.push(item)
  stack[item.level] = item
  stack.length = item.level + 1
}

function shouldSkipDuplicateTitleHeading({ entryTitle, title, level, headingIndex }: DuplicateHeadingCheck): boolean {
  return headingIndex === 0
    && level === 1
    && sameHeadingTitle({ entryTitle, title })
}

function visibleHeadingsForEntry(entryTitle: string, headings: MarkdownHeading[]): VisibleHeadings {
  return headings.reduce<VisibleHeadings>((result, heading, index) => {
    if (shouldSkipDuplicateTitleHeading({
      entryTitle,
      title: heading.title,
      level: heading.level,
      headingIndex: index,
    })) {
      return { ...result, titleBlockId: heading.blockId }
    }
    result.headings.push(heading)
    return result
  }, { headings: [] })
}

export function buildTableOfContents(entryTitle: string, blocks: unknown[]): TocItem {
  const root: TocItem = { id: 'toc-title', level: 1, title: entryTitle, children: [] }
  const stack: TocItem[] = [root]
  let headingCount = 0

  blocks.forEach((block, index) => {
    if (!isHeadingBlock(block)) return
    const title = headingText(block)
    if (!title) return

    const level = tocLevelForBlock(block)
    if (level === null) return

    if (shouldSkipDuplicateTitleHeading({ entryTitle, title, level, headingIndex: headingCount })) {
      root.blockId = block.id
      headingCount += 1
      return
    }

    const item: TocItem = {
      blockId: block.id,
      children: [],
      id: block.id ?? `toc-heading-${index}`,
      level,
      matchIndex: headingCount - (root.blockId ? 1 : 0),
      title,
    }
    appendTocHeading(stack, item)
    headingCount += 1
  })

  return root
}

function stripFrontmatter({ markdown }: { markdown: string }): string {
  if (!markdown.startsWith('---')) return markdown
  const delimiter = markdown.indexOf('\n---', 3)
  if (delimiter === -1) return markdown
  const afterDelimiter = markdown.indexOf('\n', delimiter + 4)
  return afterDelimiter === -1 ? '' : markdown.slice(afterDelimiter + 1)
}

function stripInlineMarkdown({ text }: { text: string }): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

function parseMarkdownHeadings({ markdown }: { markdown: string }): MarkdownHeading[] {
  return stripFrontmatter({ markdown })
    .split('\n')
    .map((line) => line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      level: match[1].length as TocLevel,
      title: stripInlineMarkdown({ text: match[2] }),
    }))
    .filter((heading) => heading.title.length > 0)
}

function parsedBlockHeadings(blocks: unknown[]): MarkdownHeading[] {
  return blocks
    .filter(isHeadingBlock)
    .flatMap((block) => {
      const level = tocLevelForBlock(block)
      if (level === null) return []
      return [{
        blockId: block.id,
        level,
        title: headingText(block),
      }]
    })
    .filter((heading) => heading.title.length > 0)
}

function blockIdsForMatchingHeadings({ blocks, entryTitle, headings }: HeadingBlockMatch): VisibleHeadings {
  const visibleBlocks = visibleHeadingsForEntry(entryTitle, parsedBlockHeadings(blocks))
  const visibleMarkdown = visibleHeadingsForEntry(entryTitle, headings)
  if (visibleBlocks.headings.length !== visibleMarkdown.headings.length) return visibleMarkdown

  const blockIds = visibleBlocks.headings.map((blockHeading, index) => {
    const heading = visibleMarkdown.headings[index]
    if (blockHeading.level !== heading.level) return undefined
    if (!sameHeadingTitle({ entryTitle: blockHeading.title, title: heading.title })) return undefined
    return blockHeading.blockId
  })
  if (blockIds.includes(undefined)) return visibleMarkdown

  return {
    headings: visibleMarkdown.headings.map((heading, index) => ({
      ...heading,
      blockId: blockIds[index],
    })),
    titleBlockId: visibleBlocks.titleBlockId,
  }
}

function tocItemMatchesHeading(item: TocItem, heading: MarkdownHeading | undefined): heading is MarkdownHeading {
  return heading !== undefined
    && heading.level === item.level
    && sameHeadingTitle({ entryTitle: heading.title, title: item.title })
}

function indexedHeadingForTocItem(item: TocItem, headings: MarkdownHeading[]): MarkdownHeading | undefined {
  return item.matchIndex === undefined ? undefined : headings[item.matchIndex]
}

function matchingHeadingForTocItem(item: TocItem, headings: MarkdownHeading[]): MarkdownHeading | undefined {
  const indexedHeading = indexedHeadingForTocItem(item, headings)
  return tocItemMatchesHeading(item, indexedHeading)
    ? indexedHeading
    : headings.find((heading) => tocItemMatchesHeading(item, heading))
}

export function resolveTocItemBlockId(entryTitle: string, item: TocItem, blocks: unknown[]): string | undefined {
  if (item.blockId) return item.blockId
  const visibleBlocks = visibleHeadingsForEntry(entryTitle, parsedBlockHeadings(blocks))
  if (item.id === 'toc-title') return visibleBlocks.titleBlockId
  return matchingHeadingForTocItem(item, visibleBlocks.headings)?.blockId
}

export function buildTableOfContentsFromMarkdown(entryTitle: string, markdown: string, blocks: unknown[] = []): TocItem {
  const headings = parseMarkdownHeadings({ markdown })
  const visibleHeadings = blockIdsForMatchingHeadings({ blocks, entryTitle, headings })
  const root: TocItem = {
    blockId: visibleHeadings.titleBlockId,
    id: 'toc-title',
    level: 1,
    title: entryTitle,
    children: [],
  }
  const stack: TocItem[] = [root]

  visibleHeadings.headings.forEach((heading, index) => {
    appendTocHeading(stack, {
      blockId: heading.blockId,
      children: [],
      id: heading.blockId ?? `toc-heading-${index}`,
      level: heading.level,
      matchIndex: index,
      title: heading.title,
    })
  })

  return root
}

export function buildTableOfContentsFromMarkdownOnly(entryTitle: string, markdown: string): TocItem {
  return buildTableOfContentsFromMarkdown(entryTitle, markdown)
}
