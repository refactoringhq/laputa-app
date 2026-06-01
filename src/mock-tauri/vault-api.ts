/**
 * Vault API detection and proxy for browser dev mode.
 * When a local vault API server is running, routes read and write commands
 * through it instead of returning hardcoded mock data.
 */

let vaultApiAvailable: boolean | null = null

async function detectVaultApiAvailability(): Promise<boolean> {
  try {
    const res = await fetch('/api/vault/ping', { signal: AbortSignal.timeout(500) })
    return res.ok
  } catch (error) {
    void error
    return false
  }
}

async function checkVaultApi(): Promise<boolean> {
  if (vaultApiAvailable === true) return true

  const available = await detectVaultApiAvailability()
  vaultApiAvailable = available
  console.info(`[mock-tauri] Vault API available: ${vaultApiAvailable}`)
  return available
}

interface VaultApiGetRequest {
  body: Record<string, unknown>
  kind: 'all-content' | 'content' | 'entry' | 'list' | 'search'
}

interface VaultApiPostRequest {
  body: Record<string, unknown>
  kind: 'delete' | 'rename' | 'rename-filename' | 'save'
}

type VaultApiRequest = VaultApiGetRequest | VaultApiPostRequest

/** Tracks last vault path for commands that don't receive it as an argument. */
let lastVaultPath: string | null = null

type PathQueryCommand =
  | 'reload_vault_entry'
  | 'get_note_content'
  | 'validate_note_content'
  | 'get_all_content'

function argText(args: Record<string, unknown>, key: string): string | null {
  const value = Reflect.get(args, key)
  return value ? String(value) : null
}

function commandArgs(args: Record<string, unknown>): Record<string, unknown> {
  const nestedArgs = Reflect.get(args, 'args')
  if (!nestedArgs || typeof nestedArgs !== 'object') return args
  return nestedArgs as Record<string, unknown>
}

function buildListRequest(args: Record<string, unknown>, reload: boolean): VaultApiRequest | null {
  const payload = commandArgs(args)
  const path = argText(payload, 'path')
  if (!path) return null

  lastVaultPath = path
  return { kind: 'list', body: { path, reload } }
}

function buildPathQueryRequest(cmd: PathQueryCommand, args: Record<string, unknown>): VaultApiRequest | null {
  const payload = commandArgs(args)
  const path = argText(payload, 'path')
  if (!path) return null
  return { kind: pathQueryKind(cmd), body: { path } }
}

function buildRequiredPostRequest(
  kind: VaultApiPostRequest['kind'],
  required: unknown,
  body: Record<string, unknown>,
): VaultApiRequest | null {
  return required ? { kind, body } : null
}

function buildRequiredPathPostRequest(
  kind: VaultApiPostRequest['kind'],
  args: Record<string, unknown>,
  body: Record<string, unknown>,
): VaultApiRequest | null {
  return buildRequiredPostRequest(kind, args.path, body)
}

function buildSearchRequest(args: Record<string, unknown>): VaultApiRequest | null {
  const payload = commandArgs(args)
  const query = argText(payload, 'query')
  if (!query || !lastVaultPath) return null

  const mode = argText(payload, 'mode') ?? 'all'
  const body: Record<string, unknown> = { mode, query, vault_path: lastVaultPath }
  if (Reflect.get(payload, 'excludeFrontmatter') === true) body.exclude_frontmatter = true
  return { kind: 'search', body }
}

function isPathQueryCommand(cmd: string): cmd is PathQueryCommand {
  return cmd === 'reload_vault_entry'
    || cmd === 'get_note_content'
    || cmd === 'validate_note_content'
    || cmd === 'get_all_content'
}

function pathQueryKind(command: PathQueryCommand): VaultApiGetRequest['kind'] {
  if (command === 'reload_vault_entry') return 'entry'
  if (command === 'get_all_content') return 'all-content'
  return 'content'
}

function buildPostRequest(cmd: string, args: Record<string, unknown>): VaultApiRequest | null {
  const payload = commandArgs(args)
  if (cmd === 'save_note_content') {
    return buildRequiredPathPostRequest('save', payload, {
      content: payload.content,
      path: payload.path,
    })
  }
  if (cmd === 'rename_note') {
    return buildRequiredPostRequest('rename', payload.old_path, {
      new_title: payload.new_title,
      old_path: payload.old_path,
      vault_path: payload.vault_path,
    })
  }
  if (cmd === 'rename_note_filename') {
    return buildRequiredPostRequest('rename-filename', payload.old_path, {
      new_filename_stem: payload.new_filename_stem,
      old_path: payload.old_path,
      vault_path: payload.vault_path,
    })
  }
  if (cmd === 'delete_note') return buildRequiredPathPostRequest('delete', payload, { path: payload.path })
  return null
}

function buildVaultApiRequest(cmd: string, args?: Record<string, unknown>): VaultApiRequest | null {
  if (!args) return null
  if (cmd === 'list_vault') return buildListRequest(args, false)
  if (cmd === 'reload_vault') return buildListRequest(args, true)
  if (cmd === 'search_vault') return buildSearchRequest(args)
  if (isPathQueryCommand(cmd)) return buildPathQueryRequest(cmd, args)
  return buildPostRequest(cmd, args)
}

function buildFetchOptions(request: { body: Record<string, unknown> }): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  }
}

async function fetchVaultApiResponse(request: VaultApiRequest) {
  const res = await fetchVaultApiRequest(request)
  if (!res.ok) return undefined
  return res.json()
}

function isGetRequest(request: VaultApiRequest): request is VaultApiGetRequest {
  return request.kind === 'all-content'
    || request.kind === 'content'
    || request.kind === 'entry'
    || request.kind === 'list'
    || request.kind === 'search'
}

function fetchVaultApiGetRequest(request: VaultApiGetRequest): Promise<Response> {
  if (request.kind === 'all-content') {
    return fetch('/api/vault/all-content', buildFetchOptions(request))
  }
  if (request.kind === 'content') {
    return fetch('/api/vault/content', buildFetchOptions(request))
  }
  if (request.kind === 'entry') {
    return fetch('/api/vault/entry', buildFetchOptions(request))
  }
  if (request.kind === 'list') {
    return fetch('/api/vault/list', buildFetchOptions(request))
  }
  return fetch('/api/vault/search', buildFetchOptions(request))
}

function fetchVaultApiPostRequest(request: VaultApiPostRequest): Promise<Response> {
  if (request.kind === 'delete') return fetch('/api/vault/delete', buildFetchOptions(request))
  if (request.kind === 'rename') return fetch('/api/vault/rename', buildFetchOptions(request))
  if (request.kind === 'rename-filename') return fetch('/api/vault/rename-filename', buildFetchOptions(request))
  return fetch('/api/vault/save', buildFetchOptions(request))
}

function fetchVaultApiRequest(request: VaultApiRequest): Promise<Response> {
  return isGetRequest(request)
    ? fetchVaultApiGetRequest(request)
    : fetchVaultApiPostRequest(request)
}

export async function tryVaultApi<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  const request = buildVaultApiRequest(cmd, args)
  if (!request) return undefined
  if (!await checkVaultApi()) return undefined

  try {
    const data = await fetchVaultApiResponse(request)
    if (data === undefined) return undefined
    if (cmd === 'get_note_content') return data.content as T
    if (cmd === 'validate_note_content') return (data.content === args?.content) as T
    return data as T
  } catch (err) {
    console.warn(`[mock-tauri] Vault API call failed for ${cmd}, falling back to mock:`, err)
    return undefined
  }
}
