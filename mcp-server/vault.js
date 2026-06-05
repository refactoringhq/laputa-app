/**
 * Vault operations — read-only helpers for Tolaria markdown vault.
 * Most write operations are handled by the app-managed agent's active
 * permission profile and native file-edit tools; createNote is intentionally
 * narrow so read-only agents can create a new Markdown file without overwrite.
 */
import { mkdir, open, opendir, realpath } from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

const ACTIVE_VAULT_ERROR = 'Note path must stay inside the active vault'

/**
 * Recursively find all .md files under a directory.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function findMarkdownFiles(dir) {
  const results = []
  const items = await opendir(dir)
  for await (const item of items) {
    await collectMarkdownFile(results, dir, item)
  }
  return results
}

async function resolveVaultNotePath(vaultPath, notePath) {
  const vaultRoot = await realpath(vaultPath)
  const requestedPath = resolveRequestedNotePath(vaultRoot, notePath)
  const noteRealPath = await realpath(requestedPath)
  const relativePath = path.relative(vaultRoot, noteRealPath)

  if (!isVaultRelativePath(relativePath)) {
    throw new Error(ACTIVE_VAULT_ERROR)
  }

  return {
    vaultRoot,
    noteRealPath,
    relativePath,
  }
}

/**
 * Read a note with parsed frontmatter and content.
 * @param {string} vaultPath
 * @param {string} notePath
 * @returns {Promise<{path: string, frontmatter: Record<string, unknown>, content: string}>}
 */
export async function getNote(vaultPath, notePath) {
  const {
    noteRealPath,
    relativePath,
  } = await resolveVaultNotePath(vaultPath, notePath)
  const raw = await readUtf8File(noteRealPath)
  const parsed = parseMarkdownNote(raw)
  return {
    path: relativePath,
    frontmatter: parsed.data,
    content: parsed.content.trim(),
  }
}

/**
 * Create a new markdown note inside the vault without overwriting an existing file.
 * @param {string} vaultPath
 * @param {string} notePath
 * @param {string} content
 * @returns {Promise<{path: string, absolutePath: string}>}
 */
export async function createNote(vaultPath, notePath, content) {
  const { requestedPath, relativePath } = await resolveNewVaultNotePath(vaultPath, notePath)
  await writeNewUtf8File(requestedPath, content)
  return {
    path: relativePath,
    absolutePath: requestedPath,
  }
}

/**
 * Search notes by title or content substring.
 * @param {string} vaultPath
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {Promise<Array<{path: string, title: string, snippet: string}>>}
 */
export async function searchNotes(vaultPath, query, limit = 10) {
  const files = await findMarkdownFiles(vaultPath)
  const q = query.toLowerCase()
  const results = []

  for (const filePath of files) {
    if (results.length >= limit) break
    const content = await readUtf8File(filePath)
    const filename = path.basename(filePath, '.md')
    const titleMatch = extractTitle(content, filename)
    if (!matchesSearchQuery(titleMatch, content, q)) continue

    const snippet = extractSnippet(content, q)
    results.push({
      path: path.relative(vaultPath, filePath),
      title: titleMatch,
      snippet,
    })
  }

  return results
}

/**
 * Get vault context: unique types, note count, top-level folders, and 20 most recent notes.
 * @param {string} vaultPath
 * @returns {Promise<{types: string[], noteCount: number, folders: string[], recentNotes: Array<{path: string, title: string, type: string|null}>, vaultPath: string}>}
 */
export async function vaultContext(vaultPath) {
  const files = await findMarkdownFiles(vaultPath)
  const typesSet = new Set()
  const foldersSet = new Set()
  const notesWithMtime = []

  for (const filePath of files) {
    const { topFolder, note, type } = await readVaultContextNote(vaultPath, filePath)
    if (type) typesSet.add(type)
    if (topFolder) foldersSet.add(topFolder)
    notesWithMtime.push(note)
  }

  notesWithMtime.sort((a, b) => b.mtime - a.mtime)
  const recentNotes = notesWithMtime.slice(0, 20).map(contextNoteWithoutMtime)

  return {
    types: [...typesSet].sort(),
    noteCount: files.length,
    folders: [...foldersSet].sort(),
    recentNotes,
    configFiles: await readConfigFiles(vaultPath),
    vaultPath,
  }
}

// --- Helpers ---

async function collectMarkdownFile(results, dir, item) {
  if (item.name.startsWith('.')) return

  const full = resolveInside(dir, item.name)
  if (!full) return
  if (item.isDirectory()) {
    results.push(...await findMarkdownFiles(full))
    return
  }

  if (item.name.endsWith('.md')) {
    results.push(full)
  }
}

function resolveRequestedNotePath(vaultRoot, notePath) {
  if (path.isAbsolute(notePath)) return notePath
  const resolved = resolveInside(vaultRoot, notePath)
  if (!resolved) throw new Error(ACTIVE_VAULT_ERROR)
  return resolved
}

async function resolveNewVaultNotePath(vaultPath, notePath) {
  const requestedNotePath = validateNewNotePath(notePath)
  const vaultRoot = await realpath(vaultPath)
  const requestedPath = resolveRequestedNotePath(vaultRoot, requestedNotePath)
  const relativePath = relativeNotePathInsideVault(vaultRoot, requestedPath)
  await ensureWritableParentInsideVault(vaultRoot, requestedPath)
  return { requestedPath, relativePath }
}

function validateNewNotePath(notePath) {
  const trimmedPath = typeof notePath === 'string' ? notePath.trim() : ''
  if (!trimmedPath) {
    throw new Error('Note path is required')
  }
  if (!trimmedPath.endsWith('.md')) {
    throw new Error('New notes must be markdown files ending in .md')
  }
  return trimmedPath
}

async function ensureWritableParentInsideVault(vaultRoot, requestedPath) {
  const parentPath = path.dirname(requestedPath)
  const existingAncestor = await nearestExistingAncestor(parentPath)
  assertInsideVault(vaultRoot, existingAncestor)
  await mkdir(parentPath, { recursive: true })
  assertInsideVault(vaultRoot, await realpath(parentPath))
}

async function nearestExistingAncestor(targetPath) {
  let currentPath = targetPath
  while (currentPath && currentPath !== path.dirname(currentPath)) {
    try {
      return await realpath(currentPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      currentPath = path.dirname(currentPath)
    }
  }
  return realpath(currentPath)
}

function assertInsideVault(vaultRoot, targetPath) {
  if (!isVaultRelativePath(path.relative(vaultRoot, targetPath))) {
    throw new Error(ACTIVE_VAULT_ERROR)
  }
}

function relativeNotePathInsideVault(vaultRoot, requestedPath) {
  const relativePath = path.relative(vaultRoot, requestedPath)
  if (!isVaultRelativePath(relativePath) || !relativePath) {
    throw new Error(ACTIVE_VAULT_ERROR)
  }
  return relativePath
}

function resolveInside(root, target) {
  const resolved = path.resolve(root, target)
  const relative = path.relative(root, resolved)
  if (isVaultRelativePath(relative)) return resolved
  return null
}

function isVaultRelativePath(relativePath) {
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function matchesSearchQuery(title, content, query) {
  return title.toLowerCase().includes(query) || content.toLowerCase().includes(query)
}

function contextNoteWithoutMtime(note) {
  return {
    path: note.path,
    title: note.title,
    type: note.type,
  }
}

async function readVaultContextNote(vaultPath, filePath) {
  const raw = await readUtf8File(filePath)
  const parsed = parseMarkdownNote(raw)
  const rel = path.relative(vaultPath, filePath)
  const topFolder = extractTopFolder(rel)
  const stat = await statFile(filePath)
  const type = parsed.data.type || parsed.data.is_a || null

  return {
    topFolder,
    type,
    note: {
      path: rel,
      title: parsed.data.title || extractTitle(raw, path.basename(filePath, '.md')),
      type,
      mtime: stat.mtimeMs,
    },
  }
}

function parseMarkdownNote(raw) {
  try {
    const parsed = matter(raw)
    const fallback = parseFrontmatterFallback(raw)
    return shouldUseFallbackFrontmatter(parsed, fallback) ? fallback : parsed
  } catch {
    return parseFrontmatterFallback(raw)
  }
}

function shouldUseFallbackFrontmatter(parsed, fallback) {
  return Object.keys(parsed.data).length === 0 && Object.keys(fallback.data).length > 0
}

function parseFrontmatterFallback(raw) {
  const split = splitFrontmatter(raw)
  if (!split) return { data: {}, content: raw }

  return {
    data: parseFrontmatterBlock(split.frontmatter),
    content: split.content,
  }
}

function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
  if (!match) return null
  return { frontmatter: match[1], content: match[2] }
}

function parseFrontmatterBlock(frontmatter) {
  const data = {}
  let listKey = null

  for (const line of frontmatter.split(/\r?\n/)) {
    const item = parseYamlListItem(line)
    if (listKey && item !== null) {
      data[listKey].push(parseYamlScalar(item))
      continue
    }

    listKey = null
    const field = parseTopLevelYamlField(line)
    if (!field) continue

    data[field.key] = field.value ? parseYamlValue(field.value) : []
    listKey = field.value ? null : field.key
  }

  return data
}

function parseTopLevelYamlField(line) {
  if (!line || line.trimStart() !== line || line.trimStart().startsWith('#')) return null

  const separatorIndex = line.indexOf(':')
  if (separatorIndex <= 0) return null

  return {
    key: stripMatchingQuotes(line.slice(0, separatorIndex).trim()),
    value: line.slice(separatorIndex + 1).trim(),
  }
}

function parseYamlValue(value) {
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitInlineYamlArray(value).map(parseYamlScalar)
  }
  return parseYamlScalar(value)
}

function splitInlineYamlArray(value) {
  const inner = value.slice(1, -1)
  const items = []
  let current = ''
  let quote = null

  for (const char of inner) {
    if (quote) {
      current += char
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === ',') {
      items.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  if (current.trim()) items.push(current.trim())
  return items
}

function parseYamlListItem(line) {
  const match = line.match(/^\s+-\s*(.*)$/)
  return match ? match[1].trim() : null
}

function parseYamlScalar(value) {
  const unquoted = stripMatchingQuotes(value.trim())
  if (unquoted !== value.trim()) return unquoted

  if (/^(true|yes)$/i.test(unquoted)) return true
  if (/^(false|no)$/i.test(unquoted)) return false
  if (/^(null|~)$/i.test(unquoted)) return null
  if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted)

  return unquoted
}

function stripMatchingQuotes(value) {
  const first = value[0]
  const last = value[value.length - 1]
  return (first === '"' || first === "'") && first === last ? value.slice(1, -1) : value
}

function extractTopFolder(relativePath) {
  const topFolder = relativePath.split(path.sep)[0]
  return topFolder === relativePath ? null : `${topFolder}/`
}

async function readConfigFiles(vaultPath) {
  const configFiles = {}

  try {
    const agentsPath = resolveInside(vaultPath, 'config/agents.md')
    if (agentsPath) configFiles.agents = await readUtf8File(agentsPath)
  } catch {
    // config/agents.md may not exist yet
  }

  return configFiles
}

async function readUtf8File(filePath) {
  const handle = await open(filePath, 'r')
  try {
    return await handle.readFile('utf-8')
  } finally {
    await handle.close()
  }
}

async function writeNewUtf8File(filePath, content) {
  const handle = await open(filePath, 'wx')
  try {
    await handle.writeFile(content, 'utf-8')
  } finally {
    await handle.close()
  }
}

async function statFile(filePath) {
  const handle = await open(filePath, 'r')
  try {
    return await handle.stat()
  } finally {
    await handle.close()
  }
}

/**
 * Extract title from markdown content (first H1 or frontmatter title).
 * @param {string} content
 * @param {string} fallback
 * @returns {string}
 */
function extractTitle(content, fallback) {
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match) return h1Match[1].trim()

  const titleMatch = content.match(/^title:\s*(.+)$/m)
  if (titleMatch) return titleMatch[1].trim()

  return fallback
}

/**
 * Extract a snippet around the query match.
 * @param {string} content
 * @param {string} query
 * @returns {string}
 */
function extractSnippet(content, query) {
  const body = content.replace(/^---[\s\S]*?---\n?/, '').trim()
  const idx = body.toLowerCase().indexOf(query)
  if (idx === -1) return body.slice(0, 120)
  const start = Math.max(0, idx - 40)
  const end = Math.min(body.length, idx + query.length + 80)
  return (start > 0 ? '...' : '') + body.slice(start, end) + (end < body.length ? '...' : '')
}
