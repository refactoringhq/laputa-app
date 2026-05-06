import { expect, type Page } from '@playwright/test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { installFixtureVaultDesktopBridgeInBrowser } from './fixtureVaultDesktopBridge'

const FIXTURE_VAULT = path.resolve('tests/fixtures/test-vault')
const FIXTURE_VAULT_READY_TIMEOUT = 30_000
const FIXTURE_VAULT_REMOVE_RETRIES = 10
const FIXTURE_VAULT_REMOVE_RETRY_DELAY_MS = 100
const CLAUDE_CODE_ONBOARDING_DISMISSED_KEY = 'tolaria:claude-code-onboarding-dismissed'
type FixtureCommandArgs = Record<string, unknown> | undefined

interface FixtureVaultPageArgs {
  page: Page
  vaultPath: string
  isGitRepo: boolean
}

interface FixturePageArgs {
  page: Page
}

interface FixtureVaultOptions {
  isGitRepo?: boolean
  expectedReadyTitle?: string
}

interface CopyDirArgs {
  src: string
  dest: string
}

interface RemoveFixtureVaultArgs {
  tempVaultDir: string
}

function copyDirSync({ src, dest }: CopyDirArgs): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const sourcePath = path.join(src, item.name)
    const destinationPath = path.join(dest, item.name)
    if (item.isDirectory()) {
      copyDirSync({ src: sourcePath, dest: destinationPath })
      continue
    }
    fs.copyFileSync(sourcePath, destinationPath)
  }
}

export function createFixtureVaultCopy(): string {
  const tempVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'laputa-test-vault-'))
  copyDirSync({ src: FIXTURE_VAULT, dest: tempVaultDir })
  return tempVaultDir
}

function removeFixtureVaultDirectory({ tempVaultDir }: RemoveFixtureVaultArgs): void {
  fs.rmSync(tempVaultDir, {
    recursive: true,
    force: true,
    maxRetries: FIXTURE_VAULT_REMOVE_RETRIES,
    retryDelay: FIXTURE_VAULT_REMOVE_RETRY_DELAY_MS,
  })
}

export function removeFixtureVaultCopy(tempVaultDir: string | null | undefined): void {
  if (!tempVaultDir) return
  removeFixtureVaultDirectory({ tempVaultDir })
}

async function installFixtureVaultInitScript({ page, vaultPath, isGitRepo }: FixtureVaultPageArgs): Promise<void> {
  await page.addInitScript(({ dismissedKey, initialIsGitRepo, resolvedVaultPath }: { dismissedKey: string; initialIsGitRepo: boolean; resolvedVaultPath: string }) => {
    localStorage.clear()
    localStorage.setItem(dismissedKey, '1')
    let gitRepoReady = initialIsGitRepo

    const jsonHeaders = { 'Content-Type': 'application/json' }
    const FRONTMATTER_DELIMITER = '---'
    const DEFAULT_FRONTMATTER_LINE_ENDING = '\n'
    const nativeFetch = window.fetch.bind(window)

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString()

      if (requestUrl.endsWith('/api/vault/ping') || requestUrl.includes('/api/vault/ping?')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }

      return nativeFetch(input, init)
    }

    const readJson = async (url: string, init?: RequestInit) => {
      const response = await nativeFetch(url, init)
      if (!response.ok) {
        let message = `HTTP ${response.status}`
        try {
          const body = await response.json() as { error?: string }
          message = body.error ?? message
        } catch {
          // Preserve the HTTP status fallback when the body is not JSON.
        }
        throw new Error(message)
      }
      return response.json()
    }

    const splitFrontmatter = (content: string) => {
      const lineEnding = content.startsWith(`${FRONTMATTER_DELIMITER}\r\n`)
        ? '\r\n'
        : content.startsWith(`${FRONTMATTER_DELIMITER}\n`)
          ? '\n'
          : null
      if (!lineEnding) {
        return { frontmatter: null as string | null, body: content, lineEnding: DEFAULT_FRONTMATTER_LINE_ENDING }
      }

      const afterOpen = content.slice(FRONTMATTER_DELIMITER.length + lineEnding.length)
      if (afterOpen.startsWith(FRONTMATTER_DELIMITER)) {
        return { frontmatter: '', body: afterOpen.slice(FRONTMATTER_DELIMITER.length), lineEnding }
      }

      const closeMarker = `${lineEnding}${FRONTMATTER_DELIMITER}`
      const closeIndex = afterOpen.indexOf(closeMarker)
      if (closeIndex === -1) {
        return { frontmatter: null as string | null, body: content, lineEnding: DEFAULT_FRONTMATTER_LINE_ENDING }
      }

      return {
        frontmatter: afterOpen.slice(0, closeIndex),
        body: afterOpen.slice(closeIndex + closeMarker.length),
        lineEnding,
      }
    }

    const splitFrontmatterEntries = (frontmatter: string) => {
      const lines = frontmatter.split(/\r?\n/)
      const entries: Array<{ key: string; lines: string[] }> = []
      let current: { key: string; lines: string[] } | null = null

      for (const line of lines) {
        const match = line.match(/^([^:\n]+):(.*)$/)
        if (match && !line.startsWith(' ')) {
          if (current) entries.push(current)
          current = { key: match[1].trim(), lines: [line] }
          continue
        }

        if (current) {
          current.lines.push(line)
        } else if (line.trim() !== '') {
          current = { key: '', lines: [line] }
        }
      }

      if (current) entries.push(current)
      return entries
    }

    const serializeFrontmatterValue = (value: unknown): string[] => {
      if (Array.isArray(value)) {
        if (value.length === 0) return ['[]']
        return [''].concat(value.map((item) => `  - ${JSON.stringify(String(item))}`))
      }
      if (typeof value === 'boolean' || typeof value === 'number') {
        return [String(value)]
      }
      return [JSON.stringify(String(value ?? ''))]
    }

    const replaceFrontmatterEntry = (content: string, key: string, value: unknown) => {
      const { frontmatter, body, lineEnding } = splitFrontmatter(content)
      const entryLines = serializeFrontmatterValue(value)
      const nextEntryLines =
        entryLines[0] === ''
          ? [`${key}:`, ...entryLines.slice(1)]
          : [`${key}: ${entryLines[0]}`]

      if (frontmatter === null) {
        return `${FRONTMATTER_DELIMITER}\n${nextEntryLines.join('\n')}\n${FRONTMATTER_DELIMITER}\n${body}`
      }

      const nextEntries = splitFrontmatterEntries(frontmatter)
        .filter((entry) => entry.key !== '')
        .map((entry) => (entry.key === key ? { key, lines: nextEntryLines } : entry))

      const hasEntry = nextEntries.some((entry) => entry.key === key)
      if (!hasEntry) {
        nextEntries.push({ key, lines: nextEntryLines })
      }

      return `${FRONTMATTER_DELIMITER}${lineEnding}${nextEntries.flatMap((entry) => entry.lines).join(lineEnding)}${lineEnding}${FRONTMATTER_DELIMITER}${body}`
    }

    const removeFrontmatterEntry = (content: string, key: string) => {
      const { frontmatter, body, lineEnding } = splitFrontmatter(content)
      if (frontmatter === null) return content

      const nextEntries = splitFrontmatterEntries(frontmatter)
        .filter((entry) => entry.key !== '' && entry.key !== key)

      if (nextEntries.length === 0) {
        return body
      }

      return `${FRONTMATTER_DELIMITER}${lineEnding}${nextEntries.flatMap((entry) => entry.lines).join(lineEnding)}${lineEnding}${FRONTMATTER_DELIMITER}${body}`
    }

    const persistFrontmatterChange = async (notePath: string, transform: (content: string) => string) => {
      const current = await readJson(
        `/api/vault/content?path=${encodeURIComponent(notePath)}`,
      ) as { content: string }
      const updatedContent = transform(current.content)
      await readJson('/api/vault/save', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ path: notePath, content: updatedContent }),
      })
      return updatedContent
    }

    const activeVaultList = {
      vaults: [{ label: 'Test Vault', path: resolvedVaultPath }],
      active_vault: resolvedVaultPath,
      hidden_defaults: [],
    }

    const readVaultList = (commandArgs?: Record<string, unknown>, reload = false) => {
      const resolvedPath = String(commandArgs?.path ?? resolvedVaultPath)
      return readJson(
        `/api/vault/list?path=${encodeURIComponent(resolvedPath)}&reload=${reload ? '1' : '0'}`,
      )
    }

    const renameNoteRequest = (payload: Record<string, unknown>) =>
      readJson('/api/vault/rename', {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      })

    const readCommandValue = (commandArgs: FixtureCommandArgs, key: string, fallback?: unknown) =>
      commandArgs?.[key] ?? fallback

    const readCommandString = (commandArgs: FixtureCommandArgs, key: string, fallback = '') =>
      String(readCommandValue(commandArgs, key, fallback))

    const buildFixtureStateHandlers = () => ({
      load_vault_list: () => activeVaultList,
      check_vault_exists: (commandArgs?: FixtureCommandArgs) =>
        readCommandString(commandArgs, 'path') === resolvedVaultPath,
      is_git_repo: () => gitRepoReady,
      init_git_repo: () => {
        gitRepoReady = true
        return null
      },
      get_last_vault_path: () => resolvedVaultPath,
      get_default_vault_path: () => resolvedVaultPath,
      save_vault_list: () => null,
      save_settings: () => null,
      register_mcp_tools: () => null,
      get_mcp_config_snippet: () => JSON.stringify({
        mcpServers: {
          tolaria: {
            type: 'stdio',
            command: 'node',
            args: ['/fixture/Tolaria/mcp-server/index.js'],
            env: {
              VAULT_PATH: resolvedVaultPath,
              WS_UI_PORT: '9711',
            },
          },
        },
      }, null, 2),
      reinit_telemetry: () => null,
      update_menu_state: () => null,
      get_settings: () => ({
        auto_pull_interval_minutes: 5,
        telemetry_consent: false,
        crash_reporting_enabled: null,
        analytics_enabled: null,
        anonymous_id: null,
        release_channel: null,
      }),
    })

    const buildFixtureReadHandlers = () => ({
      list_vault: (commandArgs?: FixtureCommandArgs) => readVaultList(commandArgs),
      reload_vault: (commandArgs?: FixtureCommandArgs) => readVaultList(commandArgs, true),
      list_vault_folders: () => [],
      list_views: () => [],
      get_modified_files: () => [],
      detect_renames: () => [],
      reload_vault_entry: (commandArgs?: FixtureCommandArgs) =>
        readJson(`/api/vault/entry?path=${encodeURIComponent(readCommandString(commandArgs, 'path'))}`),
      get_note_content: async (commandArgs?: FixtureCommandArgs) => {
        const data = await readJson(
          `/api/vault/content?path=${encodeURIComponent(readCommandString(commandArgs, 'path'))}`,
        ) as { content: string }
        return data.content
      },
      validate_note_content: async (commandArgs?: FixtureCommandArgs) => {
        const data = await readJson(
          `/api/vault/content?path=${encodeURIComponent(readCommandString(commandArgs, 'path'))}`,
        ) as { content: string }
        return data.content === readCommandString(commandArgs, 'content')
      },
      get_all_content: (commandArgs?: FixtureCommandArgs) =>
        readJson(
          `/api/vault/all-content?path=${encodeURIComponent(readCommandString(commandArgs, 'path', resolvedVaultPath))}`,
        ),
      search_vault: (commandArgs?: FixtureCommandArgs) => {
        const resolvedPath = readCommandString(
          commandArgs,
          'path',
          readCommandValue(commandArgs, 'vaultPath', resolvedVaultPath),
        )
        const query = encodeURIComponent(readCommandString(commandArgs, 'query'))
        const mode = encodeURIComponent(readCommandString(commandArgs, 'mode', 'all'))
        return readJson(
          `/api/vault/search?vault_path=${encodeURIComponent(resolvedPath)}&query=${query}&mode=${mode}`,
        )
      },
    })

    const buildFixtureWriteHandlers = () => ({
      save_note_content: (commandArgs?: FixtureCommandArgs) =>
        readJson('/api/vault/save', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            path: readCommandValue(commandArgs, 'path'),
            content: readCommandValue(commandArgs, 'content'),
          }),
        }),
      create_note_content: async (commandArgs?: FixtureCommandArgs) => {
        const notePath = readCommandString(commandArgs, 'path')
        const existing = await nativeFetch(`/api/vault/content?path=${encodeURIComponent(notePath)}`)
        if (existing.ok) throw new Error(`File already exists: ${notePath}`)
        return readJson('/api/vault/save', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            path: notePath,
            content: readCommandValue(commandArgs, 'content'),
          }),
        })
      },
      update_frontmatter: (commandArgs?: FixtureCommandArgs) =>
        persistFrontmatterChange(readCommandString(commandArgs, 'path'), (content) =>
          replaceFrontmatterEntry(
            content,
            readCommandString(commandArgs, 'key'),
            readCommandValue(commandArgs, 'value'),
          ),
        ),
      delete_frontmatter_property: (commandArgs?: FixtureCommandArgs) =>
        persistFrontmatterChange(
          readCommandString(commandArgs, 'path'),
          (content) => removeFrontmatterEntry(content, readCommandString(commandArgs, 'key')),
        ),
      rename_note: (commandArgs?: FixtureCommandArgs) =>
        renameNoteRequest({
          vault_path: readCommandValue(commandArgs, 'vaultPath', resolvedVaultPath),
          old_path: readCommandValue(commandArgs, 'oldPath'),
          new_title: readCommandValue(commandArgs, 'newTitle'),
          old_title: readCommandValue(commandArgs, 'oldTitle', null),
        }),
      rename_note_filename: (commandArgs?: FixtureCommandArgs) =>
        readJson('/api/vault/rename-filename', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            vault_path: readCommandValue(commandArgs, 'vaultPath', resolvedVaultPath),
            old_path: readCommandValue(commandArgs, 'oldPath'),
            new_filename_stem: readCommandValue(commandArgs, 'newFilenameStem'),
          }),
        }),
      auto_rename_untitled: async (commandArgs?: FixtureCommandArgs) => {
        const notePath = readCommandString(commandArgs, 'notePath')
        const contentData = await readJson(
          `/api/vault/content?path=${encodeURIComponent(notePath)}`,
        ) as { content: string }
        const match = contentData.content.match(/^#\s+(.+)$/m)
        if (!match) return null
        return renameNoteRequest({
          vault_path: readCommandValue(commandArgs, 'vaultPath', resolvedVaultPath),
          old_path: notePath,
          new_title: match[1].trim(),
        })
      },
    })

    const applyFixtureVaultOverrides = (
      handlers: Record<string, ((args?: unknown) => unknown)> | null | undefined,
    ) => {
      if (!handlers) return handlers
      Object.assign(
        handlers,
        buildFixtureStateHandlers(),
        buildFixtureReadHandlers(),
        buildFixtureWriteHandlers(),
      )
      return handlers
    }

    let ref = applyFixtureVaultOverrides(
      (window.__mockHandlers as Record<string, ((args?: unknown) => unknown)> | undefined),
    ) ?? null

    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      set(value) {
        ref = applyFixtureVaultOverrides(
          value as Record<string, ((args?: unknown) => unknown)> | undefined,
        ) ?? null
      },
      get() {
        return applyFixtureVaultOverrides(ref) ?? ref
      },
    })
  }, {
    dismissedKey: CLAUDE_CODE_ONBOARDING_DISMISSED_KEY,
    initialIsGitRepo: isGitRepo,
    resolvedVaultPath: vaultPath,
  })
}

async function waitForFixtureVaultReady({ page, expectedTitle }: FixturePageArgs & { expectedTitle: string }): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => Boolean(window.__mockHandlers?.list_vault))
  await page.locator('[data-testid="note-list-container"]').waitFor({ timeout: FIXTURE_VAULT_READY_TIMEOUT })
  await expect(page.getByText(expectedTitle, { exact: true }).first()).toBeVisible({
    timeout: FIXTURE_VAULT_READY_TIMEOUT,
  })
}

export async function openFixtureVault(
  page: Page,
  vaultPath: string,
  options: FixtureVaultOptions = {},
): Promise<void> {
  await installFixtureVaultInitScript({
    page,
    vaultPath,
    isGitRepo: options.isGitRepo ?? true,
  })
  await waitForFixtureVaultReady({
    page,
    expectedTitle: options.expectedReadyTitle ?? 'Alpha Project',
  })
}

async function installFixtureVaultDesktopBridge({ page }: FixturePageArgs): Promise<void> {
  await page.evaluate(installFixtureVaultDesktopBridgeInBrowser)

  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__))
}

/**
 * Browser harness for desktop command-routing tests.
 *
 * This stubs the Tauri invoke bridge inside Playwright so tests can exercise
 * renderer shortcut dispatch and desktop menu-command dispatch without a native
 * shell. It is deterministic, but it is not a substitute for real native QA.
 */
export async function openFixtureVaultDesktopHarness(
  page: Page,
  vaultPath: string,
  options: FixtureVaultOptions = {},
): Promise<void> {
  await openFixtureVault(page, vaultPath, options)
  await installFixtureVaultDesktopBridge({ page })
}

export const openFixtureVaultTauri = openFixtureVaultDesktopHarness
