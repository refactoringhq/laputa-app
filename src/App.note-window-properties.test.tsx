import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Settings, VaultEntry } from './types'
import { DEFAULT_VAULTS } from './hooks/useVaultSwitcher'
import { TooltipProvider } from './components/ui/tooltip'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    clear: () => { store = {} },
    getItem: (key: string) => store[key] ?? null,
    removeItem: (key: string) => { delete store[key] },
    setItem: (key: string, value: string) => { store[key] = value },
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })),
})

const editorSnapshots = vi.hoisted(() => [] as Array<{
  activeTabPath: string | null
  entryTitles: string[]
}>)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    innerSize: vi.fn(async () => ({ toLogical: () => ({ width: 1400, height: 900 }) })),
    scaleFactor: vi.fn(async () => 1),
    setMinSize: vi.fn(async () => {}),
    setSize: vi.fn(async () => {}),
  }),
}))

vi.mock('./components/Editor', () => ({
  Editor: (props: { activeTabPath: string | null; entries: VaultEntry[] }) => {
    const entryTitles = props.entries.map((entry) => entry.title)
    editorSnapshots.push({ activeTabPath: props.activeTabPath, entryTitles })
    return <div data-testid="mock-editor-entry-titles">{entryTitles.join('|')}</div>
  },
}))

vi.mock('./hooks/useUpdater', () => ({
  restartApp: vi.fn(),
  useUpdater: () => ({
    status: { state: 'idle' },
    actions: {
      checkForUpdates: vi.fn(async () => ({ kind: 'up-to-date' })),
      dismiss: vi.fn(),
      openReleaseNotes: vi.fn(),
      startDownload: vi.fn(),
    },
  }),
}))

vi.mock('./utils/ai-chat', async () => {
  const actual = await vi.importActual<typeof import('./utils/ai-chat')>('./utils/ai-chat')
  return {
    ...actual,
    buildSystemPrompt: vi.fn(() => ({ prompt: '', totalTokens: 0, truncated: false })),
    checkClaudeCli: vi.fn(async () => ({ installed: false })),
    streamClaudeChat: vi.fn(async () => 'mock-session'),
  }
})

vi.mock('./utils/streamAiAgent', () => ({
  streamAiAgent: vi.fn(async () => {}),
}))

function makeEntry(overrides: Partial<VaultEntry>): VaultEntry {
  return {
    path: '/vault/note.md',
    filename: 'note.md',
    title: 'Note',
    isA: 'Note',
    aliases: [],
    belongsTo: [],
    relatedTo: [],
    status: null,
    archived: false,
    modifiedAt: 1_700_000_000,
    createdAt: null,
    fileSize: 256,
    snippet: '',
    wordCount: 0,
    relationships: {},
    icon: null,
    color: null,
    order: null,
    sidebarLabel: null,
    template: null,
    sort: null,
    view: null,
    visible: true,
    organized: false,
    favorite: false,
    favoriteIndex: null,
    listPropertiesDisplay: [],
    outgoingLinks: [],
    properties: {},
    hasH1: true,
    fileKind: 'markdown',
    ...overrides,
  }
}

const activeEntry = makeEntry({
  path: '/vault/project/test.md',
  filename: 'test.md',
  title: 'Test Project',
  isA: 'Project',
})
const relatedEntry = makeEntry({
  path: '/vault/topic/dev.md',
  filename: 'dev.md',
  title: 'Software Development',
  isA: 'Topic',
})
const secondEntry = makeEntry({
  path: '/vault/project/second.md',
  filename: 'second.md',
  title: 'Second Project',
  isA: 'Project',
})
const entries = [activeEntry, relatedEntry, secondEntry]
const noteContent = '---\ntitle: Test Project\ntype: Project\n---\n\n# Test Project\n'
const defaultVaultPath = DEFAULT_VAULTS[0].path || '/Users/mock/Documents/Getting Started'

function createSettings(): Settings {
  return {
    anonymous_id: null,
    analytics_enabled: null,
    auto_pull_interval_minutes: null,
    autogit_enabled: false,
    autogit_idle_threshold_seconds: 90,
    autogit_inactive_threshold_seconds: 30,
    crash_reporting_enabled: null,
    release_channel: null,
    telemetry_consent: true,
  }
}

const commandResults: Record<string, unknown> = {}

function resetCommandResults() {
  Object.assign(commandResults, {
    check_vault_exists: true,
    get_all_content: { [activeEntry.path]: noteContent },
    get_default_vault_path: defaultVaultPath,
    get_file_history: [],
    get_modified_files: [],
    get_note_content: vi.fn(() => noteContent),
    get_settings: createSettings(),
    get_vault_settings: { theme: null },
    is_git_repo: true,
    list_themes: [],
    list_vault: vi.fn(() => entries),
    list_vault_folders: [],
    list_views: [],
    load_vault_list: {
      active_vault: '/vault',
      hidden_defaults: [],
      vaults: [{ label: 'Test Vault', path: '/vault' }],
    },
    reload_vault_entry: vi.fn(({ path }: { path: string }) =>
      entries.find((entry) => entry.path === path) ?? null,
    ),
    save_settings: null,
    sync_vault_asset_scope_for_window: null,
  })
}

function resolveCommandResult(command: string, args?: unknown) {
  const result = Reflect.get(commandResults, command) as unknown
  return typeof result === 'function'
    ? (result as (input?: unknown) => unknown)(args)
    : result ?? null
}

vi.mock('./mock-tauri', () => ({
  addMockEntry: vi.fn(),
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(async (command: string, args?: unknown) => resolveCommandResult(command, args)),
  trackMockChange: vi.fn(),
  updateMockContent: vi.fn(),
}))

import App from './App'

function renderApp(children: ReactNode) {
  return render(<TooltipProvider>{children}</TooltipProvider>)
}

describe('App note windows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    editorSnapshots.length = 0
    resetCommandResults()
    localStorage.clear()
    localStorage.setItem('tolaria:claude-code-onboarding-dismissed', '1')
    window.history.replaceState(
      {},
      '',
      '/?window=note&path=%2Fvault%2Fproject%2Ftest.md&vault=%2Fvault&title=Test+Project',
    )
  })

  it('loads the active vault graph in note windows while opening the requested note', async () => {
    renderApp(<App />)

    await waitFor(() => {
      expect(commandResults.reload_vault_entry).toHaveBeenCalledWith({
        path: activeEntry.path,
        vaultPath: '/vault',
      })
    })
    expect(commandResults.list_vault).toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByTestId('mock-editor-entry-titles')).toHaveTextContent(
        'Test Project|Software Development|Second Project',
      )
    })
    expect(editorSnapshots.at(-1)).toEqual({
      activeTabPath: activeEntry.path,
      entryTitles: ['Test Project', 'Software Development', 'Second Project'],
    })
  })

  it('opens repeated note windows through the full app vault loader', async () => {
    const firstWindow = renderApp(<App />)

    await waitFor(() => {
      expect(commandResults.reload_vault_entry).toHaveBeenCalledWith({
        path: activeEntry.path,
        vaultPath: '/vault',
      })
    })
    firstWindow.unmount()

    window.history.replaceState(
      {},
      '',
      '/?window=note&path=%2Fvault%2Fproject%2Fsecond.md&vault=%2Fvault&title=Second+Project',
    )
    renderApp(<App />)

    await waitFor(() => {
      expect(commandResults.reload_vault_entry).toHaveBeenCalledWith({
        path: secondEntry.path,
        vaultPath: '/vault',
      })
    })
    expect(commandResults.reload_vault_entry).toHaveBeenCalledTimes(2)
    expect(vi.mocked(commandResults.list_vault).mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
