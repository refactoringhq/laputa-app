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
  } catch {
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

interface VaultApiRequest {
  url: string
  method?: string
  body?: unknown
}

/** Tracks last vault path for commands that don't receive it as an argument. */
let lastVaultPath: string | null = null

function buildVaultApiRequest(cmd: string, args?: Record<string, unknown>) {
  if (!args) return null
  switch (cmd) {
    case 'list_vault':
      if (args.path) lastVaultPath = args.path as string
      return args.path ? { url: `/api/vault/list?path=${encodeURIComponent(args.path as string)}` } : null
    case 'reload_vault':
      if (args.path) lastVaultPath = args.path as string
      return args.path ? { url: `/api/vault/list?path=${encodeURIComponent(args.path as string)}&reload=1` } : null
    case 'reload_vault_entry':
      return args.path ? { url: `/api/vault/entry?path=${encodeURIComponent(args.path as string)}` } : null
    case 'get_note_content':
    case 'validate_note_content':
      return args.path ? { url: `/api/vault/content?path=${encodeURIComponent(args.path as string)}` } : null
    case 'get_all_content':
      return args.path ? { url: `/api/vault/all-content?path=${encodeURIComponent(args.path as string)}` } : null
    case 'save_note_content':
      return args.path ? { url: '/api/vault/save', method: 'POST', body: { path: args.path, content: args.content } } : null
    case 'rename_note':
      return args.old_path ? { url: '/api/vault/rename', method: 'POST', body: { vault_path: args.vault_path, old_path: args.old_path, new_title: args.new_title } } : null
    case 'rename_note_filename':
      return args.old_path ? {
        url: '/api/vault/rename-filename',
        method: 'POST',
        body: {
          vault_path: args.vault_path,
          old_path: args.old_path,
          new_filename_stem: args.new_filename_stem,
        },
      } : null
    case 'move_note_to_folder':
      return args.old_path && args.folder_path ? {
        url: '/api/vault/move-to-folder',
        method: 'POST',
        body: {
          vault_path: args.vault_path,
          old_path: args.old_path,
          folder_path: args.folder_path,
        },
      } : null
    case 'delete_note':
      return args.path ? { url: '/api/vault/delete', method: 'POST', body: { path: args.path } } : null
    case 'search_vault': {
      const q = args.query as string
      if (!q || !lastVaultPath) return null
      return { url: `/api/vault/search?vault_path=${encodeURIComponent(lastVaultPath)}&query=${encodeURIComponent(q)}&mode=${encodeURIComponent((args.mode as string) || 'all')}` }
    }
    default:
      return null
  }
}

function buildFetchOptions(request: VaultApiRequest): RequestInit {
  if (!request.body) {
    return { method: request.method || 'GET' }
  }

  return {
    method: request.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  }
}

async function fetchVaultApiResponse(request: VaultApiRequest) {
  const url = new URL(request.url, window.location.origin)
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/vault/')) return undefined
  const res = await fetch(new Request(url, buildFetchOptions(request)))
  if (!res.ok) return undefined
  return res.json()
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
