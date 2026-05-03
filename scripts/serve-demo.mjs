#!/usr/bin/env node
/**
 * Production static server for Laputa App demo.
 * Serves dist/ + handles /api/vault/* routes for browser testing.
 */

import http from 'http'
import {
  closeSync,
  createReadStream,
  fstatSync,
  openSync,
  opendirSync,
  readFileSync,
} from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.join(__dirname, '..', 'dist')
const REPO_DIR = path.resolve(__dirname, '..')
const PORT = 5173

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

function parseMarkdownFile(filePath) {
  try {
    const raw = readUtf8File(filePath)
    const { data: fm, content } = matter(raw)
    const stat = pathStats(filePath)

    const DEDICATED = new Set(['aliases','Is A','Belongs to','Related to','Status','Owner','Cadence','Created at'])
    const relationships = {}
    for (const [k, v] of Object.entries(fm)) {
      if (DEDICATED.has(k)) continue
      const links = extractWikiLinks(v)
      if (links.length) relationships[k] = links
    }

    const bodyText = content.replace(/---[\s\S]*?---/, '').trim()
    const h1 = bodyText.match(/^#\s+(.+)/m)?.[1]
    const aliases = Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : []

    return {
      path: filePath,
      filename: path.basename(filePath),
      title: h1 || aliases[0] || path.basename(filePath, '.md'),
      isA: fm['Is A'] ?? null,
      aliases,
      belongsTo: extractWikiLinks(fm['Belongs to']),
      relatedTo: extractWikiLinks(fm['Related to']),
      status: fm['Status'] ?? null,
      owner: fm['Owner'] ?? null,
      cadence: fm['Cadence'] ?? null,
      modifiedAt: stat.mtimeMs,
      createdAt: fm['Created at'] ? new Date(fm['Created at']).getTime() : null,
      fileSize: stat.size,
      snippet: bodyText.replace(/^#+\s+.+/gm, '').replace(/\n+/g, ' ').trim().slice(0, 200),
      relationships,
    }
  } catch { return null }
}

function serveVaultApi(url, res) {
  const params = new URL(url, 'http://localhost')

  if (params.pathname === '/api/vault/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return true
  }

  if (params.pathname === '/api/vault/list') {
    const dir = params.searchParams.get('path')
    if (!dir || !isAllowedPath(dir) || !pathExists(dir)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'bad path' })); return true
    }
    const entries = findMarkdownFiles(dir).map(parseMarkdownFile).filter(Boolean)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(entries))
    return true
  }

  if (params.pathname === '/api/vault/content') {
    const file = params.searchParams.get('path')
    if (!file || !isAllowedPath(file) || !pathExists(file)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'bad path' })); return true
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ content: readUtf8File(file) }))
    return true
  }

  if (params.pathname === '/api/vault/all-content') {
    const dir = params.searchParams.get('path')
    if (!dir || !isAllowedPath(dir) || !pathExists(dir)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'bad path' })); return true
    }
    const map = {}
    for (const f of findMarkdownFiles(dir)) {
      try { map[f] = readUtf8File(f) } catch {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(map))
    return true
  }

  return false
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
  console.log(`✅ Laputa demo server running on http://0.0.0.0:${PORT}`)
  console.log(`   Tailscale: https://mac-mini.tail7cbc15.ts.net`)
})
