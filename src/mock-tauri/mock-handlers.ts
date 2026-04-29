/**
 * Mock command handlers for Tauri invoke calls.
 * Each handler simulates a Tauri backend command.
 */

import type {
  VaultEntry,
  ModifiedFile,
  Settings,
  GitAddRemoteResult,
  GitPullResult,
  GitPushResult,
  GitRemoteStatus,
  LastCommitInfo,
  PulseCommit,
} from '../types'
import { MOCK_CONTENT } from './mock-content'
import { MOCK_ENTRIES } from './mock-entries'

function syncWindowContent(): void {
  if (typeof window !== 'undefined') {
    window.__mockContent = MOCK_CONTENT
  }
}

function mockFileHistory(path: string) {
  const filename = path.split('/').pop()?.replace('.md', '') ?? 'unknown'
  const ts = Math.floor(Date.now() / 1000)
  return [
    { hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', shortHash: 'a1b2c3d', message: `Update ${filename} with latest changes`, author: 'Luca Rossi', date: ts - 86400 * 2 },
    { hash: 'e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u0v1w2x3', shortHash: 'e4f5g6h', message: `Add new section to ${filename}`, author: 'Luca Rossi', date: ts - 86400 * 5 },
    { hash: 'i7j8k9l0m1n2o3p4q5r6s7t8u9v0w1x2y3z4a5b6', shortHash: 'i7j8k9l', message: `Fix formatting in ${filename}`, author: 'Luca Rossi', date: ts - 86400 * 12 },
    { hash: 'm0n1o2p3q4r5s6t7u8v9w0x1y2z3a4b5c6d7e8f9', shortHash: 'm0n1o2p', message: `Create ${filename}`, author: 'Luca Rossi', date: ts - 86400 * 30 },
  ]
}

function mockModifiedFiles(): ModifiedFile[] {
  return [
    { path: '/Users/luca/Laputa/26q1-laputa-app.md', relativePath: '26q1-laputa-app.md', status: 'modified' },
    { path: '/Users/luca/Laputa/facebook-ads-strategy.md', relativePath: 'facebook-ads-strategy.md', status: 'modified' },
    { path: '/Users/luca/Laputa/ai-agents-primer.md', relativePath: 'ai-agents-primer.md', status: 'added' },
    { path: '/Users/luca/Laputa/old-draft.md', relativePath: 'old-draft.md', status: 'deleted' },
  ]
}

function mockFileDiff(path: string): string {
  const filename = path.split('/').pop() ?? 'unknown'
  if (filename === 'old-draft.md') {
    return `diff --git a/${filename} b/${filename}
deleted file mode 100644
index abc1234..0000000
--- a/${filename}
+++ /dev/null
@@ -1,7 +0,0 @@
----
-title: Old Draft
-type: Note
----
-
-# Old Draft
-
-This note was deleted.`
  }
  return `diff --git a/${filename} b/${filename}
index abc1234..def5678 100644
--- a/${filename}
+++ b/${filename}
@@ -1,8 +1,10 @@
 ---
 title: Example Note
 type: Note
+status: Active
 ---

 # Example Note

-This is the original content.
+This is the updated content.
+
+A new paragraph has been added.`
}

function mockFileDiffAtCommit(path: string, commitHash: string): string {
  const filename = path.split('/').pop() ?? 'unknown'
  const shortHash = commitHash.slice(0, 7)
  return `diff --git a/${filename} b/${filename}
index abc1234..${shortHash} 100644
--- a/${filename}
+++ b/${filename}
@@ -5,3 +5,5 @@
 ---

 # Example Note
-Old paragraph from before ${shortHash}.
+Updated paragraph at commit ${shortHash}.
+
+New content added in this commit.`
}

let mockHasChanges = true
const mockSavedSinceCommit = new Set<string>()

let mockSettings: Settings = {
  auto_pull_interval_minutes: 5,
  autogit_enabled: false,
  autogit_idle_threshold_seconds: 90,
  autogit_inactive_threshold_seconds: 30,
  auto_advance_inbox_after_organize: false,
  telemetry_consent: false,
  crash_reporting_enabled: null,
  analytics_enabled: null,
  anonymous_id: null,
  release_channel: null,
  theme_mode: null,
  ui_language: null,
  default_ai_agent: 'claude_code',
}

const DEFAULT_MOCK_VAULT_PATH = '/Users/mock/demo-vault-v2'
const DEFAULT_MOCK_VAULT = {
  label: 'demo-vault-v2',
  path: DEFAULT_MOCK_VAULT_PATH,
}

let mockLastVaultPath: string | null = DEFAULT_MOCK_VAULT_PATH
const mockRemoteStateByVault: Record<string, boolean> = {
  [DEFAULT_MOCK_VAULT_PATH]: true,
}

let mockVaultList: { vaults: Array<{ label: string; path: string }>; active_vault: string | null } = {
  vaults: [DEFAULT_MOCK_VAULT],
  active_vault: DEFAULT_MOCK_VAULT_PATH,
}

let mockVaultAiGuidanceStatus = {
  agents_state: 'managed',
  claude_state: 'managed',
  gemini_state: 'managed',
  can_restore: false,
} as const

function normalizeMockVaultPath(path: string | null | undefined): string | null {
  const trimmed = path?.trim()
  return trimmed ? trimmed : null
}

function setMockRemoteState(path: string | null | undefined, hasRemote: boolean): void {
  const normalizedPath = normalizeMockVaultPath(path)
  if (!normalizedPath) return
  mockRemoteStateByVault[normalizedPath] = hasRemote
}

function getMockRemoteState(path: string | null | undefined): boolean {
  const normalizedPath = normalizeMockVaultPath(path)
  if (!normalizedPath) return true
  return mockRemoteStateByVault[normalizedPath] ?? true
}

function escapeRegex({ text }: { text: string }) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function relativePathStem({ path, vaultPath }: { path: string; vaultPath: string }) {
  const prefix = vaultPath.endsWith('/') ? vaultPath : `${vaultPath}/`
  if (path.startsWith(prefix)) return path.slice(prefix.length).replace(/\.md$/, '')
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

function canonicalRenameTargets({ oldTitle, oldPathStem }: { oldTitle: string; oldPathStem: string }) {
  const oldFilenameStem = oldPathStem.split('/').pop() ?? oldPathStem
  return [...new Set([oldTitle, oldPathStem, oldFilenameStem].filter(Boolean))]
}

function slugifyMockTitle({ title }: { title: string }) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function buildRenamedMockPath({ oldPath, newTitle }: { oldPath: string; newTitle: string }) {
  const parentDir = oldPath.replace(/\/[^/]+$/, '')
  return `${parentDir}/${slugifyMockTitle({ title: newTitle })}.md`
}

function replaceMockTitleFrontmatter({ content, newTitle }: { content: string; newTitle: string }) {
  return /^title:\s*/m.test(content)
    ? content.replace(/^title:\s*.*$/m, `title: ${newTitle}`)
    : content
}

function replaceRenamedWikilinks({ content, oldTargets, newPathStem }: {
  content: string
  oldTargets: string[]
  newPathStem: string
}) {
  if (oldTargets.length === 0) return content
  const pattern = new RegExp(`\\[\\[(?:${oldTargets.map((target) => escapeRegex({ text: target })).join('|')})(\\|[^\\]]*?)?\\]\\]`, 'g')
  return content.replace(pattern, (_match: string, pipe: string | undefined) =>
    pipe ? `[[${newPathStem}${pipe}]]` : `[[${newPathStem}]]`
  )
}

function updateMockRenameReferences({ newPath, newPathStem, oldTargets }: {
  newPath: string
  newPathStem: string
  oldTargets: string[]
}) {
  let updatedFiles = 0
  for (const [path, content] of Object.entries(MOCK_CONTENT)) {
    if (path === newPath) continue
    const replaced = replaceRenamedWikilinks({ content, oldTargets, newPathStem })
    if (replaced === content) continue
    MOCK_CONTENT[path] = replaced
    updatedFiles += 1
  }
  return updatedFiles
}

function handleRenameNote(args: { vault_path: string; old_path: string; new_title: string; old_title?: string | null }) {
  const oldEntry = MOCK_ENTRIES.find(e => e.path === args.old_path)
  const oldTitle = args.old_title ?? oldEntry?.title ?? ''
  const oldContent = MOCK_CONTENT[args.old_path] ?? ''
  const newPath = buildRenamedMockPath({ oldPath: args.old_path, newTitle: args.new_title })
  const oldPathStem = relativePathStem({ path: args.old_path, vaultPath: args.vault_path })
  const newPathStem = relativePathStem({ path: newPath, vaultPath: args.vault_path })

  if (oldTitle === args.new_title && newPath === args.old_path) {
    return { new_path: args.old_path, updated_files: 0, failed_updates: 0 }
  }

  const newContent = replaceMockTitleFrontmatter({ content: oldContent, newTitle: args.new_title })
  delete MOCK_CONTENT[args.old_path]
  MOCK_CONTENT[newPath] = newContent
  const oldTargets = canonicalRenameTargets({ oldTitle, oldPathStem })
  const updatedFiles = updateMockRenameReferences({ newPath, newPathStem, oldTargets })

  syncWindowContent()
  return { new_path: newPath, updated_files: updatedFiles, failed_updates: 0 }
}

function handleRenameNoteFilename(args: {
  vault_path: string
  old_path: string
  new_filename_stem: string
}) {
  const oldEntry = MOCK_ENTRIES.find(e => e.path === args.old_path)
  const oldContent = MOCK_CONTENT[args.old_path] ?? ''
  const oldTitle = oldEntry?.title ?? ''
  const normalizedStem = args.new_filename_stem.trim().replace(/\.md$/, '')
  const oldFilename = args.old_path.split('/').pop() ?? ''
  const newFilename = `${normalizedStem}.md`

  if (!normalizedStem) {
    throw new Error('Invalid filename')
  }
  if (oldFilename === newFilename) {
    return { new_path: args.old_path, updated_files: 0, failed_updates: 0 }
  }

  const parentDir = args.old_path.replace(/\/[^/]+$/, '')
  const newPath = `${parentDir}/${newFilename}`
  if (newPath !== args.old_path && Object.prototype.hasOwnProperty.call(MOCK_CONTENT, newPath)) {
    throw new Error('A note with that name already exists')
  }

  delete MOCK_CONTENT[args.old_path]
  MOCK_CONTENT[newPath] = oldContent

  const oldPathStem = relativePathStem({ path: args.old_path, vaultPath: args.vault_path })
  const newPathStem = relativePathStem({ path: newPath, vaultPath: args.vault_path })
  const oldTargets = canonicalRenameTargets({ oldTitle, oldPathStem })
  const updatedFiles = updateMockRenameReferences({ newPath, newPathStem, oldTargets })

  syncWindowContent()
  return { new_path: newPath, updated_files: updatedFiles, failed_updates: 0 }
}

function handleMoveNoteToFolder(args: {
  vault_path: string
  old_path: string
  folder_path: string
}) {
  const oldEntry = MOCK_ENTRIES.find(e => e.path === args.old_path)
  const oldContent = MOCK_CONTENT[args.old_path] ?? ''
  const oldTitle = oldEntry?.title ?? ''
  const oldFilename = args.old_path.split('/').pop() ?? ''
  const normalizedFolderPath = args.folder_path.trim().replace(/^\/+|\/+$/g, '')

  if (!normalizedFolderPath) {
    throw new Error('Folder path cannot be empty')
  }

  const vaultRoot = args.vault_path.replace(/\/+$/, '')
  const newPath = `${vaultRoot}/${normalizedFolderPath}/${oldFilename}`
  if (newPath === args.old_path) {
    return { new_path: args.old_path, updated_files: 0, failed_updates: 0 }
  }
  if (Object.prototype.hasOwnProperty.call(MOCK_CONTENT, newPath)) {
    throw new Error('A note with that name already exists')
  }

  delete MOCK_CONTENT[args.old_path]
  MOCK_CONTENT[newPath] = oldContent

  const oldPathStem = relativePathStem({ path: args.old_path, vaultPath: args.vault_path })
  const newPathStem = relativePathStem({ path: newPath, vaultPath: args.vault_path })
  const oldTargets = canonicalRenameTargets({ oldTitle, oldPathStem })
  const updatedFiles = updateMockRenameReferences({ newPath, newPathStem, oldTargets })

  syncWindowContent()
  return { new_path: newPath, updated_files: updatedFiles, failed_updates: 0 }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock handler map accepts heterogeneous arg types
export const mockHandlers: Record<string, (args: any) => any> = {
  list_vault: () => MOCK_ENTRIES,
  list_vault_folders: () => [],
  list_views: () => [],
  save_view_cmd: () => {},
  delete_view_cmd: () => {},
  reload_vault: () => MOCK_ENTRIES,
  reload_vault_entry: (args: { path: string }) => MOCK_ENTRIES.find(e => e.path === args.path) ?? { path: args.path, title: 'Unknown', filename: 'unknown.md', aliases: [], belongsTo: [], relatedTo: [], archived: false, snippet: '', wordCount: 0, fileSize: 0, relationships: {}, outgoingLinks: [], properties: {} },
  sync_note_title: () => false,
  get_note_content: (args: { path: string }) => MOCK_CONTENT[args.path] ?? '',
  validate_note_content: (args: { path: string; content: string }) => (MOCK_CONTENT[args.path] ?? '') === args.content,
  get_all_content: () => MOCK_CONTENT,
  get_file_history: (args: { path: string }) => mockFileHistory(args.path),
  get_modified_files: () => {
    const base = mockHasChanges ? mockModifiedFiles() : []
    const basePaths = new Set(base.map(f => f.path))
    const extra: ModifiedFile[] = [...mockSavedSinceCommit]
      .filter(p => !basePaths.has(p))
      .map(p => ({ path: p, relativePath: p.replace(/^.*?\/Laputa\//, ''), status: 'modified' as const }))
    return [...base, ...extra]
  },
  get_file_diff: (args: { path: string }) => mockFileDiff(args.path),
  get_file_diff_at_commit: (args: { path: string; commitHash: string }) => mockFileDiffAtCommit(args.path, args.commitHash),
  git_discard_file: () => {},
  git_commit: (args: { message: string }) => {
    const count = (mockHasChanges ? mockModifiedFiles().length : 0) + mockSavedSinceCommit.size
    mockHasChanges = false
    mockSavedSinceCommit.clear()
    return `[main abc1234] ${args.message}\n ${count} files changed`
  },
  get_build_number: () => 'bDEV',
  get_last_commit_info: (): LastCommitInfo => ({ shortHash: 'a1b2c3d', commitUrl: 'https://github.com/lucaong/laputa-vault/commit/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0' }),
  is_git_repo: () => true,
  init_git_repo: () => null,
  git_pull: (): GitPullResult => ({ status: 'up_to_date', message: 'Already up to date', updatedFiles: [], conflictFiles: [] }),
  git_push: (): GitPushResult => ({ status: 'ok', message: 'Pushed to remote' }),
  git_remote_status: (args?: { vaultPath?: string; vault_path?: string }): GitRemoteStatus => {
    const vaultPath = args?.vaultPath ?? args?.vault_path ?? mockLastVaultPath ?? DEFAULT_MOCK_VAULT_PATH
    return { branch: 'main', ahead: 0, behind: 0, hasRemote: getMockRemoteState(vaultPath) }
  },
  git_add_remote: (args?: {
    request?: { vaultPath?: string; vault_path?: string; remoteUrl?: string }
    vaultPath?: string
    vault_path?: string
    remoteUrl?: string
  }): GitAddRemoteResult => {
    const request = args?.request ?? args ?? {}
    const vaultPath = request.vaultPath ?? request.vault_path ?? mockLastVaultPath ?? DEFAULT_MOCK_VAULT_PATH
    setMockRemoteState(vaultPath, true)
    return {
      status: 'connected',
      message: 'Remote connected. This vault now tracks origin/main.',
    }
  },
  get_vault_pulse: (args: { limit?: number }): PulseCommit[] => {
    const limit = args.limit ?? 30
    const ts = Math.floor(Date.now() / 1000)
    const commits: PulseCommit[] = [
      { hash: 'a1b2c3d4e5f6', shortHash: 'a1b2c3d', message: 'Update project notes and add new experiment', date: ts - 3600, githubUrl: 'https://github.com/lucaong/laputa-vault/commit/a1b2c3d4e5f6', files: [{ path: '26q1-laputa-app.md', status: 'modified', title: '26q1 laputa app' }, { path: 'ai-search.md', status: 'added', title: 'ai search' }], added: 1, modified: 1, deleted: 0 },
      { hash: 'b2c3d4e5f6g7', shortHash: 'b2c3d4e', message: 'Reorganize people notes', date: ts - 86400, githubUrl: 'https://github.com/lucaong/laputa-vault/commit/b2c3d4e5f6g7', files: [{ path: 'alice-johnson.md', status: 'modified', title: 'alice johnson' }, { path: 'bob-smith.md', status: 'modified', title: 'bob smith' }, { path: 'old-contact.md', status: 'deleted', title: 'old contact' }], added: 0, modified: 2, deleted: 1 },
      { hash: 'c3d4e5f6g7h8', shortHash: 'c3d4e5f', message: 'Add daily journal entry', date: ts - 172800, githubUrl: null, files: [{ path: '2026-03-03.md', status: 'added', title: '2026 03 03' }], added: 1, modified: 0, deleted: 0 },
    ]
    return commits.slice(0, limit)
  },
  get_conflict_files: (): string[] => [],
  get_conflict_mode: () => 'none',
  check_claude_cli: () => ({ installed: false, version: null }),
  get_ai_agents_status: () => ({
    claude_code: { installed: false, version: null },
    codex: { installed: false, version: null },
    opencode: { installed: false, version: null },
    pi: { installed: false, version: null },
    gemini: { installed: false, version: null },
  }),
  get_vault_ai_guidance_status: () => ({ ...mockVaultAiGuidanceStatus }),
  restore_vault_ai_guidance: () => {
    mockVaultAiGuidanceStatus = {
      agents_state: 'managed',
      claude_state: 'managed',
      gemini_state: 'managed',
      can_restore: false,
    }
    return { ...mockVaultAiGuidanceStatus }
  },
  stream_claude_chat: () => 'mock-session',
  stream_ai_agent: () => null,
  save_note_content: (args: { path: string; content: string }) => {
    MOCK_CONTENT[args.path] = args.content
    mockSavedSinceCommit.add(args.path)
    syncWindowContent()
    return null
  },
  save_image: (args: { vault_path?: string; filename: string; data: string }) => {
    const vault = args.vault_path ?? '/Users/luca/Laputa'
    return `${vault}/attachments/${Date.now()}-${args.filename}`
  },
  copy_image_to_vault: (args: { vault_path?: string; source_path: string }) => {
    const vault = args.vault_path ?? '/Users/luca/Laputa'
    const filename = args.source_path.split('/').pop() ?? 'image.png'
    return `${vault}/attachments/${Date.now()}-${filename}`
  },
  get_settings: () => ({ ...mockSettings }),
  save_settings: (args: { settings: Settings }) => {
    const s = args.settings
    mockSettings = {
      auto_pull_interval_minutes: s.auto_pull_interval_minutes ?? 5,
      autogit_enabled: s.autogit_enabled ?? false,
      autogit_idle_threshold_seconds: s.autogit_idle_threshold_seconds ?? 90,
      autogit_inactive_threshold_seconds: s.autogit_inactive_threshold_seconds ?? 30,
      auto_advance_inbox_after_organize: s.auto_advance_inbox_after_organize ?? false,
      telemetry_consent: s.telemetry_consent,
      crash_reporting_enabled: s.crash_reporting_enabled,
      analytics_enabled: s.analytics_enabled,
      anonymous_id: s.anonymous_id,
      release_channel: s.release_channel,
      theme_mode: s.theme_mode ?? null,
      ui_language: s.ui_language ?? null,
      default_ai_agent: s.default_ai_agent ?? null,
    }
    return null
  },
  load_vault_list: () => ({ ...mockVaultList, vaults: [...mockVaultList.vaults] }),
  save_vault_list: (args: { list: typeof mockVaultList }) => { mockVaultList = { ...args.list }; return null },
  rename_note: handleRenameNote,
  rename_note_filename: handleRenameNoteFilename,
  move_note_to_folder: handleMoveNoteToFolder,
  clone_repo: (args: { url: string; localPath?: string; local_path?: string }) => {
    const localPath = args.localPath ?? args.local_path ?? ''
    setMockRemoteState(localPath, true)
    return `Cloned to ${localPath}`
  },
  clone_git_repo: (args: { url: string; localPath?: string; local_path?: string }) => {
    const localPath = args.localPath ?? args.local_path ?? ''
    setMockRemoteState(localPath, true)
    return `Cloned to ${localPath}`
  },
  purge_trash: () => [],
  delete_note: (args: { path: string }) => args.path,
  batch_delete_notes: (args: { paths: string[] }) => args.paths,
  empty_trash: () => [],
  migrate_is_a_to_type: () => 0,
  batch_archive_notes: (args: { paths: string[] }) => args.paths.length,
  batch_trash_notes: (args: { paths: string[] }) => args.paths.length,
  search_vault: (args: { query: string; mode: string }) => {
    const q = (args.query ?? '').toLowerCase()
    if (!q) return { results: [], elapsed_ms: 0, query: q, mode: args.mode }
    const matches = MOCK_ENTRIES
      .filter(e => {
        const content = MOCK_CONTENT[e.path] ?? ''
        return e.title.toLowerCase().includes(q) || content.toLowerCase().includes(q)
      })
      .slice(0, 20)
      .map((e, i) => ({
        title: e.title,
        path: e.path,
        snippet: e.snippet || '',
        score: 1.0 - i * 0.05,
        note_type: e.isA,
      }))
    return { results: matches, elapsed_ms: 42, query: q, mode: args.mode }
  },
  get_last_vault_path: () => mockLastVaultPath,
  set_last_vault_path: (args: { path: string }) => { mockLastVaultPath = args.path; return null },
  get_default_vault_path: () => '/Users/mock/Documents/Getting Started',
  check_vault_exists: (args: { path: string }) => {
    // In mock mode, the demo-vault-v2 path always "exists"
    return args.path.includes('demo-vault-v2')
  },
  create_empty_vault: (args: { targetPath?: string; target_path?: string }) => {
    const targetPath = args.targetPath || args.target_path || '/Users/mock/Documents/My Vault'
    setMockRemoteState(targetPath, false)
    return targetPath
  },
  create_getting_started_vault: (args: { targetPath?: string | null }) => {
    const targetPath = args.targetPath || '/Users/mock/Documents/Getting Started'
    setMockRemoteState(targetPath, false)
    return targetPath
  },
  register_mcp_tools: () => 'registered',
  check_mcp_status: () => 'installed',
  get_mcp_config_snippet: (args: { vaultPath?: string }) => JSON.stringify({
    mcpServers: {
      tolaria: {
        type: 'stdio',
        command: 'node',
        args: ['/mock/Tolaria/mcp-server/index.js'],
        env: {
          VAULT_PATH: args.vaultPath ?? '/Users/mock/Documents/Getting Started',
          WS_UI_PORT: '9711',
        },
      },
    },
  }, null, 2),
  sync_mcp_bridge_vault: (args: { vaultPath?: string | null }) => args.vaultPath ? 'started' : 'stopped',
  repair_vault: (): string => {
    mockVaultAiGuidanceStatus = {
      agents_state: 'managed',
      claude_state: 'managed',
      gemini_state: 'managed',
      can_restore: false,
    }
    return 'Vault repaired'
  },
  reinit_telemetry: (): null => null,
}

export function addMockEntry(_entry: VaultEntry, content: string): void {
  MOCK_CONTENT[_entry.path] = content
  syncWindowContent()
}

export function updateMockContent(path: string, content: string): void {
  MOCK_CONTENT[path] = content
  syncWindowContent()
}

export function trackMockChange(path: string): void {
  mockSavedSinceCommit.add(path)
}
