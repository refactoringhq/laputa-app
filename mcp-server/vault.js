/**
 * Vault operations — read-only helpers for Tolaria markdown vault.
 * Write operations are handled by the app-managed agent's active permission
 * profile and native file-edit tools when available.
 */
import fs from 'node:fs/promises'
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
  const items = await fs.readdir(dir, { withFileTypes: true })
  for (const item of items) {
    await collectMarkdownFile(results, dir, item)
  }
  return results
}

async function resolveVaultNotePath(vaultPath, notePath) {
  const vaultRoot = await fs.realpath(vaultPath)
  const requestedPath = resolveRequestedNotePath(vaultRoot, notePath)
  const noteRealPath = await fs.realpath(requestedPath)
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
  const raw = await fs.readFile(noteRealPath, 'utf-8')
  const parsed = matter(raw)
  return {
    path: relativePath,
    frontmatter: parsed.data,
    content: parsed.content.trim(),
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
    const content = await fs.readFile(filePath, 'utf-8')
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
  const recentNotes = notesWithMtime.slice(0, 20).map(({ mtime: _mtime, ...rest }) => rest)

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

  const full = path.join(dir, item.name)
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
  return path.resolve(vaultRoot, notePath)
}

function isVaultRelativePath(relativePath) {
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function matchesSearchQuery(title, content, query) {
  return title.toLowerCase().includes(query) || content.toLowerCase().includes(query)
}

async function readVaultContextNote(vaultPath, filePath) {
  const raw = await fs.readFile(filePath, 'utf-8')
  const parsed = matter(raw)
  const rel = path.relative(vaultPath, filePath)
  const topFolder = extractTopFolder(rel)
  const stat = await fs.stat(filePath)
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

function extractTopFolder(relativePath) {
  const topFolder = relativePath.split(path.sep)[0]
  return topFolder === relativePath ? null : `${topFolder}/`
}

async function readConfigFiles(vaultPath) {
  const configFiles = {}

  try {
    const agentsPath = path.join(vaultPath, 'config', 'agents.md')
    configFiles.agents = await fs.readFile(agentsPath, 'utf-8')
  } catch {
    // config/agents.md may not exist yet
  }

  return configFiles
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
