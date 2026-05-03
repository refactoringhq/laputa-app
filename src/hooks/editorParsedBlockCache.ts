export type EditorBlocks = unknown[]

export interface ParsedNoteBlockCacheEntry {
  blocks: EditorBlocks
  path: string
  scrollTop: number
  sourceContent: string
  sourceBytes: number
  vaultPath?: string
}

export const PARSED_NOTE_BLOCK_CACHE_LIMIT = 16
export const PARSED_NOTE_BLOCK_ENTRY_MAX_BYTES = 2 * 1024 * 1024
export const PARSED_NOTE_BLOCK_CACHE_MAX_SOURCE_BYTES = 12 * 1024 * 1024

const parsedBlockCache = new Map<string, ParsedNoteBlockCacheEntry>()
const sourceSizeEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

function cacheKey(path: string, vaultPath?: string): string {
  return `${vaultPath ?? ''}\0${path}`
}

function sourceBytes(content: string): number {
  return sourceSizeEncoder ? sourceSizeEncoder.encode(content).byteLength : content.length
}

function cloneBlocks(blocks: EditorBlocks): EditorBlocks {
  if (typeof structuredClone === 'function') return structuredClone(blocks)
  return JSON.parse(JSON.stringify(blocks)) as EditorBlocks
}

function retainedSourceBytes(): number {
  let totalBytes = 0
  for (const entry of parsedBlockCache.values()) totalBytes += entry.sourceBytes
  return totalBytes
}

function trimParsedBlockCache(): void {
  while (
    parsedBlockCache.size > PARSED_NOTE_BLOCK_CACHE_LIMIT
    || retainedSourceBytes() > PARSED_NOTE_BLOCK_CACHE_MAX_SOURCE_BYTES
  ) {
    const oldestKey = parsedBlockCache.keys().next().value
    if (!oldestKey) return
    parsedBlockCache.delete(oldestKey)
  }
}

export function cacheParsedNoteBlocks(entry: Omit<ParsedNoteBlockCacheEntry, 'sourceBytes'>): void {
  const nextSourceBytes = sourceBytes(entry.sourceContent)
  if (nextSourceBytes > PARSED_NOTE_BLOCK_ENTRY_MAX_BYTES) {
    parsedBlockCache.delete(cacheKey(entry.path, entry.vaultPath))
    return
  }

  const key = cacheKey(entry.path, entry.vaultPath)
  if (parsedBlockCache.has(key)) parsedBlockCache.delete(key)
  parsedBlockCache.set(key, {
    ...entry,
    blocks: cloneBlocks(entry.blocks),
    sourceBytes: nextSourceBytes,
  })
  trimParsedBlockCache()
}

export function readParsedNoteBlocks(options: {
  content: string
  path: string
  vaultPath?: string
}): { blocks: EditorBlocks; scrollTop: number } | null {
  const key = cacheKey(options.path, options.vaultPath)
  const entry = parsedBlockCache.get(key)
  if (!entry || entry.sourceContent !== options.content) return null

  parsedBlockCache.delete(key)
  parsedBlockCache.set(key, entry)
  return {
    blocks: cloneBlocks(entry.blocks),
    scrollTop: entry.scrollTop,
  }
}

export function clearParsedNoteBlockCache(path?: string): void {
  if (!path) {
    parsedBlockCache.clear()
    return
  }

  for (const [key, entry] of parsedBlockCache) {
    if (entry.path === path) parsedBlockCache.delete(key)
  }
}
