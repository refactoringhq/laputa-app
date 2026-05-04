export interface TableOfContentsItem {
  id: string
  level: number
  text: string
  children: TableOfContentsItem[]
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: UnknownRecord, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function readChildren(record: UnknownRecord): unknown[] {
  const value = record.children
  return Array.isArray(value) ? value : []
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function collectTextSegments(value: unknown, segments: string[]) {
  if (typeof value === 'string') {
    segments.push(value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectTextSegments(item, segments)
    return
  }

  if (!isRecord(value)) return

  const text = readString(value, 'text')
  if (text !== null) segments.push(text)
  collectTextSegments(value.content, segments)
  collectTextSegments(value.children, segments)
}

function extractInlineText(content: unknown): string {
  const segments: string[] = []
  collectTextSegments(content, segments)
  return normalizeText(segments.join(' '))
}

function parseHeadingLevel(rawLevel: unknown): number | null {
  const level =
    typeof rawLevel === 'string'
      ? Number(rawLevel)
      : typeof rawLevel === 'number'
        ? rawLevel
        : Number.NaN
  if (!Number.isInteger(level)) return null
  if (level < 1 || level > 6) return null
  return level
}

function headingLevel(block: UnknownRecord): number | null {
  if (readString(block, 'type') !== 'heading') return null
  const props = isRecord(block.props) ? block.props : {}
  return parseHeadingLevel(props.level)
}

function buildHeadingItem(block: UnknownRecord): TableOfContentsItem | null {
  const id = readString(block, 'id')
  const level = headingLevel(block)
  if (!id || level === null) return null

  return {
    id,
    level,
    text: extractInlineText(block.content),
    children: [],
  }
}

function collectHeadingItems(blocks: unknown): TableOfContentsItem[] {
  if (!Array.isArray(blocks)) return []

  const items: TableOfContentsItem[] = []
  for (const block of blocks) {
    if (!isRecord(block)) continue

    const heading = buildHeadingItem(block)
    if (heading) items.push(heading)
    items.push(...collectHeadingItems(readChildren(block)))
  }
  return items
}

function appendHeadingItem(
  roots: TableOfContentsItem[],
  stack: TableOfContentsItem[],
  item: TableOfContentsItem,
) {
  while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
    stack.pop()
  }

  const parent = stack[stack.length - 1]
  if (parent) {
    parent.children.push(item)
  } else {
    roots.push(item)
  }
  stack.push(item)
}

export function extractTableOfContents(blocks: unknown): TableOfContentsItem[] {
  const roots: TableOfContentsItem[] = []
  const stack: TableOfContentsItem[] = []

  for (const item of collectHeadingItems(blocks)) {
    appendHeadingItem(roots, stack, item)
  }
  return roots
}
