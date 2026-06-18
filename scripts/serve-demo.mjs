#!/usr/bin/env node
/**
 * Production static server for Laputa App demo.
 * Serves dist/ + handles /api/vault/* routes for browser testing.
 */

import http from 'http'
import { log } from 'console'
import {
  closeSync,
  createReadStream,
  fstatSync,
  openSync,
  opendirSync,
  readFileSync,
} from 'fs'
import path from 'path'
import { fileURLToPath, URL } from 'url'
import matter from 'gray-matter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')
const REPO_DIR = path.resolve(__dirname, '..')
const PORT = 5173
const DEDICATED_FRONTMATTER_KEYS = new Set([
  'aliases',
  'Is A',
  'Belongs to',
  'Related to',
  'Status',
  'Owner',
  'Cadence',
  'Created at',
])

function isAllowedPath(p) {
  return isInsideRelativePath(path.relative(REPO_DIR, p))
}

function isInsideRelativePath(relative) {
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveInside(root, target) {
  const normalizedTarget = path.normalize(target)
  if (path.isAbsolute(normalizedTarget)) return null
  const candidate = path.normalize(`${root}${path.sep}${normalizedTarget}`)
  return isInsideRelativePath(path.relative(root, candidate)) ? candidate : null
}

function readUtf8File(filePath) {
  const fd = openSync(filePath, 'r')
  try {
    return readFileSync(fd, 'utf-8')
  } finally {
    closeSync(fd)
  }
}

function pathStats(filePath) {
  const fd = openSync(filePath, 'r')
  try {
    return fstatSync(fd)
  } finally {
    closeSync(fd)
  }
}

function pathExists(filePath) {
  try {
    pathStats(filePath)
    return true
  } catch {
    return false
  }
}

function directoryEntries(dir) {
  const directory = opendirSync(dir)
  try {
    const entries = []
    let entry = directory.readSync()
    while (entry) {
      entries.push(entry)
      entry = directory.readSync()
    }
    return entries
  } finally {
    directory.closeSync()
  }
}

function streamFile(filePath) {
  const fd = openSync(filePath, 'r')
  return createReadStream(null, { fd, autoClose: true })
}

function staticAssetPath(url) {
  const pathname = new URL(url, 'http://localhost').pathname
  const requested = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  return resolveInside(DIST_DIR, requested) ?? path.normalize(`${DIST_DIR}${path.sep}index.html`)
}

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.json': 'application/json',
}

function findMarkdownFiles(dir) {
  const results = []
  try {
    for (const entry of directoryEntries(dir)) {
      const full = resolveInside(dir, entry.name)
      if (!full) continue
      if (entry.isDirectory()) results.push(...findMarkdownFiles(full))
      else if (entry.name.endsWith('.md')) results.push(full)
    }
  } catch {}
  return results
}

function extractWikiLinks(value) {
  if (!value) return []
  const str = Array.isArray(value) ? value.join(' ') : String(value)
  return [...str.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => `[[${m[1]}]]`)
}

function frontmatterRelationships(frontmatter) {
  const relationships = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (DEDICATED_FRONTMATTER_KEYS.has(key)) continue
    const links = extractWikiLinks(value)
    if (links.length) relationships[key] = links
  }
  return relationships
}

function aliasesFrom(frontmatter) {
  if (Array.isArray(frontmatter.aliases)) return frontmatter.aliases
  return frontmatter.aliases ? [frontmatter.aliases] : []
}

function markdownBodyText(content) {
  return content.replace(/---[\s\S]*?---/, '').trim()
}

function markdownTitle(bodyText, aliases, filePath) {
  const h1 = bodyText.match(/^#\s+(.+)/m)?.[1]
  return h1 || aliases[0] || path.basename(filePath, '.md')
}

function createdAtMillis(frontmatter) {
  return frontmatter['Created at'] ? new Date(frontmatter['Created at']).getTime() : null
}

function snippetFrom(bodyText) {
  return bodyText
    .replace(/^#+\s+.+/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
    .slice(0, 200)
}

function parseMarkdownFile(filePath) {
  try {
    const raw = readUtf8File(filePath)
    const { data: fm, content } = matter(raw)
    const stat = pathStats(filePath)
    const bodyText = markdownBodyText(content)
    const aliases = aliasesFrom(fm)

    return {
      path: filePath,
      filename: path.basename(filePath),
      title: markdownTitle(bodyText, aliases, filePath),
      isA: fm['Is A'] ?? null,
      aliases,
      belongsTo: extractWikiLinks(fm['Belongs to']),
      relatedTo: extractWikiLinks(fm['Related to']),
      status: fm['Status'] ?? null,
      owner: fm['Owner'] ?? null,
      cadence: fm['Cadence'] ?? null,
      modifiedAt: stat.mtimeMs,
      createdAt: createdAtMillis(fm),
      fileSize: stat.size,
      snippet: snippetFrom(bodyText),
      relationships: frontmatterRelationships(fm),
    }
  } catch { return null }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function badPath(res) {
  sendJson(res, 400, { error: 'bad path' })
}

function existingAllowedPath(params) {
  const requestedPath = params.searchParams.get('path')
  return requestedPath && isAllowedPath(requestedPath) && pathExists(requestedPath)
    ? requestedPath
    : null
}

function handleVaultPing(_params, res) {
  sendJson(res, 200, { ok: true })
}

function handleVaultList(params, res) {
  const dir = existingAllowedPath(params)
  if (!dir) return badPath(res)
  const entries = findMarkdownFiles(dir).map(parseMarkdownFile).filter(Boolean)
  sendJson(res, 200, entries)
}

function handleVaultContent(params, res) {
  const file = existingAllowedPath(params)
  if (!file) return badPath(res)
  sendJson(res, 200, { content: readUtf8File(file) })
}

function allVaultContent(dir) {
  const map = {}
  for (const filePath of findMarkdownFiles(dir)) {
    try { map[filePath] = readUtf8File(filePath) } catch {}
  }
  return map
}

function handleVaultAllContent(params, res) {
  const dir = existingAllowedPath(params)
  if (!dir) return badPath(res)
  sendJson(res, 200, allVaultContent(dir))
}

const VAULT_API_ROUTES = new Map([
  ['/api/vault/ping', handleVaultPing],
  ['/api/vault/list', handleVaultList],
  ['/api/vault/content', handleVaultContent],
  ['/api/vault/all-content', handleVaultAllContent],
])

function serveVaultApi(url, res) {
  const params = new URL(url, 'http://localhost')
  const handler = VAULT_API_ROUTES.get(params.pathname)
  if (!handler) return false
  handler(params, res)
  return true
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/'

  // API routes
  if (url.startsWith('/api/vault/')) {
    if (!serveVaultApi(url, res)) {
      res.writeHead(404); res.end()
    }
    return
  }

  // Static files
  let filePath = staticAssetPath(url)
  if (!pathExists(filePath) || pathStats(filePath).isDirectory()) {
    filePath = path.normalize(`${DIST_DIR}${path.sep}index.html`) // SPA fallback
  }
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
  streamFile(filePath).pipe(res)
})

server.listen(PORT, '0.0.0.0', () => {
  log(`✅ Laputa demo server running on http://0.0.0.0:${PORT}`)
  log(`   Tailscale: https://mac-mini.tail7cbc15.ts.net`)
})
