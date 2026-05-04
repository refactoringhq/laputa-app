/// <reference types="vitest/config" />
import type { IncomingMessage, ServerResponse } from 'http'
import path from 'path'
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from 'fs'
import os from 'os'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import matter from 'gray-matter'

// --- Vault API middleware (dev only) ---

interface VaultEntry {
  path: string
  filename: string
  title: string
  isA: string | null
  aliases: string[]
  belongsTo: string[]
  relatedTo: string[]
  status: string | null
  archived: boolean
  trashed: boolean
  trashedAt: number | null
  modifiedAt: number | null
  createdAt: number | null
  fileSize: number
  snippet: string
  wordCount: number
  relationships: Record<string, string[]>
  icon: string | null
  color: string | null
  order: number | null
  sidebarLabel: string | null
  template: string | null
  sort: string | null
  view: string | null
  visible: boolean | null
  outgoingLinks: string[]
  properties: Record<string, string | number | boolean | null>
}

/** Extract all [[wiki-links]] from a string. */
function extractWikiLinks(value: string): string[] {
  const matches = value.match(/\[\[[^\]]+\]\]/g)
  return matches ?? []
}

/** Extract wiki-links from a frontmatter value (string or array of strings). */
function wikiLinksFromValue(value: unknown): string[] {
  return collectWikiLinksFromValue(value, 0)
}

function collectWikiLinksFromValue(value: unknown, depth: number): string[] {
  if (typeof value === 'string') return extractWikiLinks(value)
  if (!Array.isArray(value)) return []

  const nestedLink = nestedFlowWikilink(value, depth)
  if (nestedLink) return [nestedLink]
  return value.flatMap((item) => collectWikiLinksFromValue(item, depth + 1))
}

function nestedFlowWikilink(value: unknown[], depth: number): string | null {
  if (depth === 0 || value.length !== 1 || typeof value[0] !== 'string') return null
  return extractWikiLinks(value[0]).length === 0 ? `[[${value[0]}]]` : null
}

// Frontmatter keys that map to dedicated VaultEntry fields (skip in generic properties/relationships)
const DEDICATED_KEYS = new Set([
  'aliases', 'is_a', 'is a', 'type', 'status', 'title', '_archived',
  'archived', '_icon', 'icon', 'color', '_order', 'order',
  '_sidebar_label', 'sidebar_label', 'sidebar label', 'template',
  '_sort', 'sort', 'view', '_width', 'width', 'visible',
  '_organized', '_favorite', '_favorite_index', '_list_properties_display',
].map((key) => key.toLowerCase()))

type FrontmatterPropertyValue = string | number | boolean | null
type VaultSearchResult = { title: string; path: string; snippet: string; score: number; note_type: string | null }

interface SearchEntryInput {
  entry: VaultEntry
  query: string
  rawContent: string
}

interface SearchRequestInput {
  query: string
  vaultPath: string
}

interface SearchResponseInput {
  mode: string
  query: string
  results: VaultSearchResult[]
}

function getFrontmatterValue(
  frontmatter: Record<string, unknown>,
  keys: string[],
): unknown {
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()))
  return Object.entries(frontmatter).find(([key]) => normalizedKeys.has(key.toLowerCase()))?.[1]
}

function parseYamlBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return null

  switch (value.toLowerCase()) {
    case 'true':
    case 'yes':
      return true
    case 'false':
    case 'no':
      return false
    default:
      return null
  }
}

const vitestCoverageDirectory = process.env.VITEST_COVERAGE_DIR
  ?? path.join(os.tmpdir(), 'tolaria-vitest-coverage', String(process.pid))

const devServerWatchIgnored = [
  '**/coverage/**',
  '**/test-results/**',
  '**/playwright-report/**',
  '**/dist/**',
  '**/src-tauri/target/**',
]

function readUtf8File(filePath: string): string {
  const fd = openSync(filePath, 'r')
  try {
    return readFileSync(fd, 'utf-8')
  } finally {
    closeSync(fd)
  }
}

function writeUtf8File(filePath: string, content: string): void {
  const fd = openSync(filePath, 'w')
  try {
    writeFileSync(fd, content, 'utf-8')
  } finally {
    closeSync(fd)
  }
}

function pathStats(filePath: string) {
  const fd = openSync(filePath, 'r')
  try {
    return fstatSync(fd)
  } finally {
    closeSync(fd)
  }
}

function pathExists(filePath: string): boolean {
  try {
    pathStats(filePath)
    return true
  } catch {
    return false
  }
}

function directoryEntries(dir: string): Dirent[] {
  const directory = opendirSync(dir)
  try {
    const entries: Dirent[] = []
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

function isInsideRelativePath(relative: string): boolean {
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function resolveInside(root: string, target: string): string | null {
  const normalizedTarget = path.normalize(target)
  if (path.isAbsolute(normalizedTarget)) return null
  const candidate = path.normalize(`${root}${path.sep}${normalizedTarget}`)
  return isInsideRelativePath(path.relative(root, candidate)) ? candidate : null
}

function frontmatterString(frontmatter: Record<string, unknown>, ...keys: string[]): string | null {
  const value = getFrontmatterValue(frontmatter, keys)
  return typeof value === 'string' ? value : null
}

function frontmatterStringArray(frontmatter: Record<string, unknown>, ...keys: string[]): string[] {
  const value = getFrontmatterValue(frontmatter, keys)
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') return [value]
  return []
}

function frontmatterBool(frontmatter: Record<string, unknown>, ...keys: string[]): boolean | null {
  return parseYamlBool(getFrontmatterValue(frontmatter, keys))
}

function markdownTitle(content: string, frontmatter: Record<string, unknown>, fallback: string): string {
  const title = frontmatterString(frontmatter, 'title')
  if (title) return title

  const h1Match = content.match(/^#\s+(.+)$/m)
  return h1Match ? h1Match[1].trim() : fallback
}

function markdownBodyText(content: string): string {
  return content.replace(/^#+\s+.+$/gm, '').replace(/[\n\r]+/g, ' ').trim()
}

function frontmatterWikiLinks(frontmatter: Record<string, unknown>, ...keys: string[]): string[] {
  return frontmatterStringArray(frontmatter, ...keys).flatMap((value) => extractWikiLinks(value))
}

function frontmatterRelationships(frontmatter: Record<string, unknown>): Record<string, string[]> {
  const relationships: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (DEDICATED_KEYS.has(key.toLowerCase())) continue
    const links = wikiLinksFromValue(value)
    if (links.length > 0) relationships[key] = links
  }
  return relationships
}

function frontmatterProperties(frontmatter: Record<string, unknown>): Record<string, FrontmatterPropertyValue> {
  const properties: Record<string, FrontmatterPropertyValue> = {}
  for (const [key, value] of Object.entries(frontmatter)) {
    if (DEDICATED_KEYS.has(key.toLowerCase()) || key.trim().startsWith('_')) continue
    const propertyValue = frontmatterPropertyValue(value)
    if (propertyValue !== undefined) properties[key] = propertyValue
  }
  return properties
}

function isScalarFrontmatterProperty(value: unknown): value is number | boolean {
  return typeof value === 'number' || typeof value === 'boolean'
}

function singleStringArrayValue(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  if (value.length !== 1) return undefined
  return typeof value[0] === 'string' ? value[0] : undefined
}

function wikiLinkFreeString(value: string): string | undefined {
  return extractWikiLinks(value).length === 0 ? value : undefined
}

function frontmatterPropertyValue(value: unknown): FrontmatterPropertyValue | undefined {
  if (value === null) return null
  if (isScalarFrontmatterProperty(value)) return value
  if (typeof value === 'string') return wikiLinkFreeString(value)
  const singleArrayValue = singleStringArrayValue(value)
  return singleArrayValue === undefined ? undefined : wikiLinkFreeString(singleArrayValue)
}

function parseMarkdownFile(filePath: string): VaultEntry | null {
  try {
    const raw = readUtf8File(filePath)
    const stats = pathStats(filePath)
    const { data, content } = matter(raw)
    const fm = data as Record<string, unknown>

    const filename = path.basename(filePath)
    const basename = filename.replace(/\.md$/, '')

    const title = markdownTitle(content, fm, basename)
    const bodyText = markdownBodyText(content)
    const snippet = bodyText.slice(0, 200)

    return {
      path: filePath,
      filename,
      title,
      isA: frontmatterString(fm, 'is_a', 'is a', 'type'),
      aliases: frontmatterStringArray(fm, 'aliases'),
      belongsTo: frontmatterWikiLinks(fm, 'belongs_to', 'belongs to'),
      relatedTo: frontmatterWikiLinks(fm, 'related_to', 'related to'),
      status: frontmatterString(fm, 'status'),
      archived: frontmatterBool(fm, 'archived') ?? false,
      trashed: frontmatterBool(fm, 'trashed') ?? false,
      trashedAt: null,
      modifiedAt: stats.mtimeMs,
      createdAt: stats.birthtimeMs,
      fileSize: stats.size,
      snippet,
      wordCount: bodyText.split(/\s+/).filter(Boolean).length,
      relationships: frontmatterRelationships(fm),
      icon: frontmatterString(fm, 'icon'),
      color: frontmatterString(fm, 'color'),
      order: fm.order != null ? Number(fm.order) : null,
      sidebarLabel: frontmatterString(fm, 'sidebar label', 'sidebar_label'),
      template: frontmatterString(fm, 'template'),
      sort: frontmatterString(fm, 'sort'),
      view: frontmatterString(fm, 'view'),
      visible: frontmatterBool(fm, 'visible'),
      outgoingLinks: [],
      properties: frontmatterProperties(fm),
    }
  } catch {
    return null
  }
}

/** Recursively find all .md files under a directory. */
function findMarkdownFiles(dir: string): string[] {
  const results: string[] = []
  try {
    const items = directoryEntries(dir)
    for (const item of items) {
      if (item.name.startsWith('.')) continue
      const full = resolveInside(dir, item.name)
      if (!full) continue
      if (item.isDirectory()) {
        results.push(...findMarkdownFiles(full))
      } else if (item.name.endsWith('.md')) {
        results.push(full)
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return results
}

function sendJson(res: ServerResponse, payload: unknown, statusCode = 200): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function readExistingQueryPath(url: URL, res: ServerResponse, key: string): string | null {
  const filePath = url.searchParams.get(key)
  if (!filePath || !pathExists(filePath)) {
    sendJson(res, { error: 'Invalid or missing path' }, 400)
    return null
  }
  return filePath
}

function updateTitleWikilinks(vaultPath: string, oldTitle: string, _newTitle: string, excludePath: string): number {
  const newPathStem = path.relative(vaultPath, excludePath).replace(/\.md$/i, '')
  const oldTargets = collectLegacyWikilinkTargets(oldTitle, excludePath, vaultPath)
  return updateWikilinksForTargets(vaultPath, oldTargets, newPathStem, excludePath)
}

function collectLegacyWikilinkTargets(oldTitle: string, oldPath: string, vaultPath: string): string[] {
  const oldRelativeStem = path.relative(vaultPath, oldPath).replace(/\.md$/i, '')
  const oldFilenameStem = path.basename(oldPath, '.md')
  return [...new Set([oldTitle, oldRelativeStem, oldFilenameStem].filter(Boolean))]
}

function updateWikilinksForTargets(vaultPath: string, oldTargets: string[], newTarget: string, excludePath: string): number {
  if (oldTargets.length === 0) return 0
  const allFiles = findMarkdownFiles(vaultPath)
  const targets = new Set(oldTargets)
  let updatedFiles = 0
  for (const filePath of allFiles) {
    if (filePath === excludePath) continue
    try {
      const content = readUtf8File(filePath)
      const replaced = content.replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, (match: string, target: string, pipe: string | undefined) => {
        if (!targets.has(target)) return match
        return pipe ? `[[${newTarget}${pipe}]]` : `[[${newTarget}]]`
      })
      if (replaced !== content) {
        writeUtf8File(filePath, replaced)
        updatedFiles++
      }
    } catch {
      // Skip unreadable files in the dev vault API.
    }
  }
  return updatedFiles
}

function updatePathWikilinks(vaultPath: string, oldPath: string, newPath: string, oldTitle: string): number {
  const newRelativeStem = path.relative(vaultPath, newPath).replace(/\.md$/i, '')
  const oldTargets = collectLegacyWikilinkTargets(oldTitle, oldPath, vaultPath)
  return updateWikilinksForTargets(vaultPath, oldTargets, newRelativeStem, newPath)
}

function handleVaultPing(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== '/api/vault/ping') return false
  sendJson(res, { ok: true })
  return true
}

function handleVaultList(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== '/api/vault/list') return false
  const dirPath = readExistingQueryPath(url, res, 'path')
  if (!dirPath) return true
  const entries = findMarkdownFiles(dirPath).map(parseMarkdownFile).filter(Boolean)
  sendJson(res, entries)
  return true
}

function handleVaultContent(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== '/api/vault/content') return false
  const filePath = readExistingQueryPath(url, res, 'path')
  if (!filePath) return true
  sendJson(res, { content: readUtf8File(filePath) })
  return true
}

function handleVaultAllContent(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== '/api/vault/all-content') return false
  const dirPath = readExistingQueryPath(url, res, 'path')
  if (!dirPath) return true
  const contentMap: Record<string, string> = {}
  for (const filePath of findMarkdownFiles(dirPath)) {
    try {
      contentMap[filePath] = readUtf8File(filePath)
    } catch {
      // Skip unreadable files.
    }
  }
  sendJson(res, contentMap)
  return true
}

function handleVaultEntry(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== '/api/vault/entry') return false
  const filePath = readExistingQueryPath(url, res, 'path')
  if (!filePath) return true
  sendJson(res, parseMarkdownFile(filePath))
  return true
}

function handleVaultSearch(url: URL, res: ServerResponse): boolean {
  if (url.pathname !== '/api/vault/search') return false
  const vaultPath = url.searchParams.get('vault_path')
  const query = (url.searchParams.get('query') ?? '').toLowerCase()
  const mode = url.searchParams.get('mode') ?? 'all'
  if (!vaultPath || !query) {
    sendVaultSearchResponse(res, { results: [], query, mode })
    return true
  }

  sendVaultSearchResponse(res, {
    results: collectVaultSearchResults({ vaultPath, query }),
    query,
    mode,
  })
  return true
}

function collectVaultSearchResults({ vaultPath, query }: SearchRequestInput): VaultSearchResult[] {
  const results: VaultSearchResult[] = []
  for (const filePath of findMarkdownFiles(vaultPath)) {
    const entry = parseMarkdownFile(filePath)
    if (!entry || entry.trashed) continue
    const rawContent = readUtf8File(filePath)
    if (entryMatchesSearch({ entry, rawContent, query })) results.push(searchResultFromEntry(entry))
  }
  return results.slice(0, 20)
}

function entryMatchesSearch({ entry, rawContent, query }: SearchEntryInput): boolean {
  return entry.title.toLowerCase().includes(query) || rawContent.toLowerCase().includes(query)
}

function searchResultFromEntry(entry: VaultEntry): VaultSearchResult {
  return { title: entry.title, path: entry.path, snippet: entry.snippet, score: 1.0, note_type: entry.isA }
}

function sendVaultSearchResponse(res: ServerResponse, { results, query, mode }: SearchResponseInput): void {
  sendJson(res, { results, elapsed_ms: results.length > 0 ? 1 : 0, query, mode })
}

async function handleVaultSave(url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!isPostRoute(url, req, '/api/vault/save')) return false
  try {
    await saveVaultContent(req, res)
  } catch (err: unknown) {
    sendCaughtError(res, err, 'Save failed')
  }
  return true
}

async function saveVaultContent(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { path: filePath, content } = await readJsonBody<{ path?: string; content?: string }>(req)
  if (!filePath || content === undefined) {
    sendJson(res, { error: 'Missing path or content' }, 400)
    return
  }

  mkdirSync(path.dirname(filePath), { recursive: true })
  writeUtf8File(filePath, content)
  sendJson(res, null)
}

async function handleVaultRename(url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!isPostRoute(url, req, '/api/vault/rename')) return false
  try {
    await renameVaultNoteTitle(req, res)
  } catch (err: unknown) {
    sendCaughtError(res, err, 'Rename failed')
  }
  return true
}

async function renameVaultNoteTitle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const {
    vault_path: vaultPath,
    old_path: oldPath,
    new_title: newTitle,
  } = await readJsonBody<{ vault_path?: string; old_path: string; new_title: string }>(req)
  const oldContent = readUtf8File(oldPath)
  const oldTitle = oldContent.match(/^# (.+)$/m)?.[1]?.trim() ?? ''
  const slug = newTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const newPath = markdownSiblingPath(oldPath, slug)
  if (!newPath) {
    sendJson(res, { error: 'Invalid title' }, 400)
    return
  }

  writeUtf8File(newPath, oldContent.replace(/^# .+$/m, `# ${newTitle}`))
  if (newPath !== oldPath) unlinkSync(oldPath)

  const updatedFiles = vaultPath ? updateTitleWikilinks(vaultPath, oldTitle, newTitle, newPath) : 0
  sendJson(res, { new_path: newPath, updated_files: updatedFiles })
}

type FilenameStemValidation =
  | { ok: true; stem: string }
  | { ok: false; error: string }

function validateMarkdownFilenameStem(value: unknown): FilenameStemValidation {
  const stem = String(value ?? '').trim().replace(/\.md$/i, '').trim()
  if (!stem) return { ok: false, error: 'New filename cannot be empty' }
  if (isUnsafeMarkdownFilenameStem(stem)) return { ok: false, error: 'Invalid filename' }
  return { ok: true, stem }
}

function isUnsafeMarkdownFilenameStem(stem: string): boolean {
  return stem === '.' || stem === '..' || stem.includes('/') || stem.includes('\\')
}

function markdownSiblingPath(filePath: string, stem: string): string | null {
  if (isUnsafeMarkdownFilenameStem(stem)) return null
  return resolveInside(path.dirname(filePath), `${stem}.md`)
}

async function handleVaultRenameFilename(url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!isPostRoute(url, req, '/api/vault/rename-filename')) return false
  try {
    await renameVaultNoteFilename(req, res)
  } catch (err: unknown) {
    sendCaughtError(res, err, 'Rename failed')
  }
  return true
}

async function renameVaultNoteFilename(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const {
    vault_path: vaultPath,
    old_path: oldPath,
    new_filename_stem: newFilenameStem,
  } = await readJsonBody<{ vault_path?: string; old_path: string; new_filename_stem: string }>(req)
  const filename = validateMarkdownFilenameStem(newFilenameStem)
  if (!filename.ok) {
    sendJson(res, { error: filename.error }, 400)
    return
  }

  const newPath = markdownSiblingPath(oldPath, filename.stem)
  if (!newPath) {
    sendJson(res, { error: 'Invalid filename' }, 400)
    return
  }
  if (newPath !== oldPath && pathExists(newPath)) {
    sendJson(res, { error: 'A note with that name already exists' }, 409)
    return
  }

  const oldTitle = parseMarkdownFile(oldPath)?.title ?? path.basename(oldPath, '.md')
  renameSync(oldPath, newPath)
  const updatedFiles = vaultPath ? updatePathWikilinks(vaultPath, oldPath, newPath, oldTitle) : 0
  sendJson(res, { new_path: newPath, updated_files: updatedFiles })
}

async function handleVaultDelete(url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (url.pathname !== '/api/vault/delete' || req.method !== 'POST') return false
  try {
    const body = await readRequestBody(req)
    const { path: filePath } = JSON.parse(body)
    if (!filePath) {
      sendJson(res, { error: 'Missing path' }, 400)
      return true
    }
    unlinkSync(filePath)
    sendJson(res, filePath)
  } catch (err: unknown) {
    sendJson(res, { error: err instanceof Error ? err.message : 'Delete failed' }, 500)
  }
  return true
}

async function handleVaultApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const handlers = [
    () => Promise.resolve(handleVaultPing(url, res)),
    () => Promise.resolve(handleVaultList(url, res)),
    () => Promise.resolve(handleVaultContent(url, res)),
    () => Promise.resolve(handleVaultAllContent(url, res)),
    () => Promise.resolve(handleVaultEntry(url, res)),
    () => Promise.resolve(handleVaultSearch(url, res)),
    () => handleVaultSave(url, req, res),
    () => handleVaultRename(url, req, res),
    () => handleVaultRenameFilename(url, req, res),
    () => handleVaultDelete(url, req, res),
  ]

  for (const handler of handlers) {
    if (await handler()) return true
  }

  return false
}

function vaultApiPlugin(): Plugin {
  return {
    name: 'vault-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (await handleVaultApiRequest(req, res)) return
        next()
      })
    },
  }
}

// --- Proxy helpers ---

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
  })
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return JSON.parse(await readRequestBody(req)) as T
}

function isPostRoute(url: URL, req: IncomingMessage, pathname: string): boolean {
  return url.pathname === pathname && req.method === 'POST'
}

function sendCaughtError(res: ServerResponse, err: unknown, fallback: string): void {
  sendJson(res, { error: err instanceof Error ? err.message : fallback }, 500)
}

/** WebSocket proxy info endpoint — tells the frontend where the MCP bridge is */
function mcpBridgeInfoPlugin(): Plugin {
  return {
    name: 'mcp-bridge-info',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/api/mcp/info') return next()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          wsUrl: `ws://localhost:${process.env.MCP_WS_PORT || 9710}`,
          available: true,
        }))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), vaultApiPlugin(), mcpBridgeInfoPlugin()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Inject the demo-vault-v2 path in local dev only — production Tauri builds and
  // CI must resolve the default vault path at runtime via the backend to avoid
  // baking the CI runner's absolute path into the distributed bundle.
  define: {
    ...(process.env.CI || (process.env.TAURI_PLATFORM && !process.env.TAURI_DEBUG)
      ? {}
      : { __DEMO_VAULT_PATH__: JSON.stringify(path.resolve(__dirname, 'demo-vault-v2')) }),
  },

  // Prevent vite from obscuring Rust errors
  clearScreen: false,

  // Tauri expects a fixed port
  server: {
    port: 5202,
    strictPort: true,
    allowedHosts: true,
    watch: {
      ignored: devServerWatchIgnored,
    },
  },

  // Env variables starting with TAURI_ are exposed to the frontend
  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux
    target: process.env.TAURI_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // Keep coverage temp files off the mounted workspace to avoid flaky
      // read-after-write races when Vitest re-reads its own coverage shards.
      reportsDirectory: vitestCoverageDirectory,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        'src/mock-tauri.ts',
        'src/main.tsx',
        'src/types.ts',
        'src/hooks/useMcpBridge.ts',
        'src/hooks/useAiAgent.ts',
        'src/utils/ai-chat.ts',
        'src/utils/ai-agent.ts',
        'src/components/ui/dropdown-menu.tsx',
        'src/components/ui/scroll-area.tsx',
        'src/components/ui/select.tsx',
        'src/components/ui/separator.tsx',
        'src/components/ui/tabs.tsx',
        'src/components/ui/tooltip.tsx',
        'src/components/ui/card.tsx',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
})
