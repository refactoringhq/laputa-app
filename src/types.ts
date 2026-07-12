import type { AiAgentId } from './lib/aiAgents'
import type { AiAgentPermissionMode } from './lib/aiAgentPermissionMode'
import type { AiModelProvider } from './lib/aiTargets'
import type { ThemeMode } from './lib/themeMode'
import type { AppLocale } from './lib/i18n'
import type { DateDisplayFormat } from './utils/dateDisplay'

export type VaultPropertyScalar = string | number | boolean | null
export type VaultPropertyArray = Array<string | number | boolean>
export type VaultPropertyValue = VaultPropertyScalar | VaultPropertyArray

export interface VaultEntry {
  path: string
  filename: string
  title: string
  workspace?: WorkspaceIdentity
  isA: string | null
  aliases: string[]
  belongsTo: string[]
  relatedTo: string[]
  status: string | null
  // Note: owner and cadence are now stored in the generic `properties` map,
  // accessed via entry.properties?.Owner and entry.properties?.Cadence
  archived: boolean
  modifiedAt: number | null
  createdAt: number | null
  fileSize: number
  snippet: string
  wordCount: number
  /** Generic relationship fields: any frontmatter key whose value contains wikilinks. */
  relationships: Record<string, string[]>
  /** Phosphor icon name (kebab-case) for Type entries, e.g. "cooking-pot" */
  icon: string | null
  /** Accent color key for Type entries: "red" | "purple" | "blue" | "green" | "yellow" | "orange" */
  color: string | null
  /** Display order for Type entries in sidebar (lower = higher). null = use default order. */
  order: number | null
  /** Custom sidebar section label for Type entries, overriding auto-pluralization. */
  sidebarLabel: string | null
  /** Markdown template for Type entries. Pre-fills new notes created with this type. */
  template: string | null
  /** Default sort preference for the note list of this Type. Format: "option:direction". */
  sort: string | null
  /** Default view mode for the note list of this Type: "all", "editor-list", or "editor-only". */
  view: string | null
  /** Rich-editor note width mode from `_width` frontmatter. null means use the default. */
  noteWidth?: NoteWidthMode | null
  /** Editor display mode from `_display` frontmatter. null means text/default. */
  display?: NoteDisplayMode | null
  /** Whether this Type is visible in the sidebar. Defaults to true when absent. */
  visible: boolean | null
  /** Whether this note has been explicitly organized (removed from Inbox). */
  organized: boolean
  /** Whether this note is a user favorite (shown in FAVORITES sidebar section). */
  favorite: boolean
  /** Display order within the FAVORITES section (lower = higher). */
  favoriteIndex: number | null
  /** Properties to display as chips in the note list for this Type's notes. */
  listPropertiesDisplay: string[]
  /** All wikilink targets found in the note content. Extracted from [[target]] patterns. */
  outgoingLinks: string[]
  /** Custom scalar and scalar-array frontmatter properties (non-relationship, non-structural). */
  properties: Record<string, VaultPropertyValue>
  /** Whether the note body has an H1 heading on the first non-empty line. */
  hasH1: boolean
  /** File kind: "markdown", "text", or "binary". Determines editor behavior.
   *  Defaults to "markdown" when absent (for backwards compatibility). */
  fileKind?: 'markdown' | 'text' | 'binary'
  /** First image found in the note body (for card/thumbnail views). */
  firstImage?: string | null
}

export interface WorkspaceIdentity {
  id: string
  label: string
  alias: string
  path: string
  shortLabel: string
  color: string | null
  icon: string | null
  mounted: boolean
  available: boolean
  defaultForNewNotes: boolean
}

export type NoteStatus = 'new' | 'modified' | 'clean' | 'pendingSave' | 'unsaved'

export interface GitCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  date: number // unix timestamp
}

export type GitAuthorIdentitySource = 'environment' | 'fallback' | 'global' | 'repository' | 'system' | 'unknown'
export type GitAuthorIdentityWarning = 'local_overrides_global'

export interface GitAuthorIdentity {
  name: string
  email: string
  source: GitAuthorIdentitySource
  warning: GitAuthorIdentityWarning | null
}

export interface LastCommitInfo {
  shortHash: string
  commitUrl: string | null
}

export interface ModifiedFile {
  path: string
  relativePath: string
  vaultPath?: string
  status: 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed'
  addedLines?: number | null
  deletedLines?: number | null
  binary?: boolean
}

export interface Settings {
  auto_pull_interval_minutes: number | null
  git_enabled?: boolean | null
  git_path?: string | null
  git_provider?: GitProviderId | null
  git_wsl_distro?: string | null
  autogit_enabled?: boolean | null
  autogit_use_ai_commit_messages?: boolean | null
  autogit_idle_threshold_seconds?: number | null
  autogit_inactive_threshold_seconds?: number | null
  auto_advance_inbox_after_organize?: boolean | null
  telemetry_consent: boolean | null
  crash_reporting_enabled: boolean | null
  analytics_enabled: boolean | null
  anonymous_id: string | null
  release_channel: string | null
  automatic_update_checks_enabled?: boolean | null
  theme_mode?: ThemeMode | null
  ui_language?: AppLocale | null
  date_display_format?: DateDisplayFormat | null
  note_width_mode?: NoteWidthMode | null
  sidebar_type_pluralization_enabled?: boolean | null
  initial_h1_auto_rename_enabled?: boolean | null
  ai_features_enabled?: boolean | null
  default_ai_agent?: AiAgentId | null
  default_ai_target?: string | null
  ai_model_providers?: AiModelProvider[] | null
  ai_workspace_conversations?: AiWorkspaceConversationSetting[] | null
  hide_gitignored_files?: boolean | null
  all_notes_show_pdfs?: boolean | null
  all_notes_show_images?: boolean | null
  all_notes_show_unsupported?: boolean | null
  multi_workspace_enabled?: boolean | null
}

export interface AiWorkspaceConversationSetting {
  archived?: boolean | null
  id: string
  target_id?: string | null
  title: string
}

export interface GitPullResult {
  status: 'up_to_date' | 'updated' | 'conflict' | 'no_remote' | 'error'
  message: string
  updatedFiles: string[]
  conflictFiles: string[]
}

export interface GitPushResult {
  status: 'ok' | 'rejected' | 'auth_error' | 'network_error' | 'no_remote' | 'error'
  message: string
}

export interface GitAddRemoteResult {
  status: 'connected' | 'already_configured' | 'incompatible_history' | 'auth_error' | 'network_error' | 'error'
  message: string
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'conflict' | 'pull_required'

export interface GitRemoteStatus {
  branch: string
  ahead: number
  behind: number
  hasRemote: boolean
  hasUpstream?: boolean
  upstream?: string | null
}

export type GitProviderId = 'native' | 'wsl'

export interface GitProviderProbe {
  provider: GitProviderId
  label: string
  available: boolean
  version: string | null
  distro: string | null
  path: string | null
  message: string
}

export interface GitProviderStatus {
  selected_provider: GitProviderId
  selected_wsl_distro: string | null
  native: GitProviderProbe
  wsl_distributions: GitProviderProbe[]
}

export interface SearchResult {
  title: string
  path: string
  snippet: string
  score: number
  noteType: string | null
}

export interface SearchResponse {
  results: SearchResult[]
  elapsedMs: number
  query: string
  mode: string
}

export type SearchMode = 'keyword' | 'semantic' | 'hybrid'

/** Vault-scoped UI configuration stored locally per vault path. */
export interface InboxConfig {
  noteListProperties: string[] | null
  explicitOrganization?: boolean | null
}

/** Vault-scoped UI configuration stored locally per vault path. */
export interface AllNotesConfig {
  noteListProperties: string[] | null
}

/** Vault-scoped UI configuration stored locally per vault path. */
export type NoteLayout = 'centered' | 'left'

export type NoteWidthMode = 'normal' | 'wide'
export type NoteDisplayMode = 'text' | 'sheet'
export type GitSetupPreference = 'prompt' | 'never'

/** Vault-scoped UI configuration stored locally per vault path. */
export interface VaultConfig {
  zoom: number | null
  view_mode: string | null
  editor_mode: string | null
  note_layout?: NoteLayout | null
  git_setup_preference?: GitSetupPreference | null
  ai_agent_permission_mode?: AiAgentPermissionMode | null
  tag_colors: Record<string, string> | null
  status_colors: Record<string, string> | null
  property_display_modes: Record<string, string> | null
  inbox?: InboxConfig | null
  allNotes?: AllNotesConfig | null
}

export interface PulseFile {
  path: string
  status: 'added' | 'modified' | 'deleted'
  title: string
}

export interface PulseCommit {
  hash: string
  shortHash: string
  message: string
  date: number
  githubUrl: string | null
  files: PulseFile[]
  added: number
  modified: number
  deleted: number
}

export type SidebarFilter = 'all' | 'archived' | 'changes' | 'pulse' | 'inbox' | 'favorites'

export type InboxPeriod = 'week' | 'month' | 'quarter' | 'all'

export type SidebarSelection =
  | { kind: 'filter'; filter: SidebarFilter }
  | { kind: 'sectionGroup'; type: string }
  | { kind: 'folder'; path: string; rootPath?: string }
  | { kind: 'entity'; entry: VaultEntry }
  | { kind: 'view'; filename: string; rootPath?: string }

// --- Custom Views ---

export type FilterOp = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'any_of' | 'none_of' | 'is_empty' | 'is_not_empty' | 'before' | 'after'

export interface FilterCondition {
  field: string
  op: FilterOp
  value?: unknown
  regex?: boolean
}

export type FilterGroup = { all: FilterNode[] } | { any: FilterNode[] }
export type FilterNode = FilterCondition | FilterGroup

export interface ViewDefinition {
  name: string
  icon: string | null
  color: string | null
  /** Display order for saved Views in sidebar/list surfaces (lower = higher). */
  order?: number | null
  sort: string | null
  listPropertiesDisplay?: string[]
  filters: FilterGroup
}

export interface ViewFile {
  filename: string
  definition: ViewDefinition
  rootPath?: string
  workspace?: WorkspaceIdentity
}

/** A node in the vault's folder tree (directories only, no files). */
export interface FolderNode {
  name: string
  path: string
  rootPath?: string
  children: FolderNode[]
}

/**
 * Context for a folder-create request: where the new folder should land.
 * `path` is vault-relative (`''` means vault root); `rootPath` identifies the
 * target vault when multiple workspaces are mounted.
 */
export interface FolderCreationParent {
  path: string
  rootPath?: string
}
