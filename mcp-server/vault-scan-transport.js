import { streamFileStationMarkdownFiles } from './filestation-scan.js'
import { streamMarkdownFiles } from './vault-scan.js'

const HTTP_TRANSPORT = 'filestation-http'
const FILESYSTEM_TRANSPORT = 'filesystem'

export function createEphemeralSessionProvider(env = process.env) {
  const sid = env.TOLARIA_FILESTATION_SID?.trim()
  delete env.TOLARIA_FILESTATION_SID
  const available = sid || null
  return () => {
    if (!available) throw Object.assign(new Error('FileStation session is unavailable'), { code: 'FILESTATION_AUTH_REQUIRED' })
    return available
  }
}

export function createVaultScanDispatcher({ env = process.env, fetchImpl = fetch, sessionProvider } = {}) {
  const transport = (env.TOLARIA_VAULT_TRANSPORT || FILESYSTEM_TRANSPORT).trim().toLowerCase()
  if (![FILESYSTEM_TRANSPORT, HTTP_TRANSPORT].includes(transport)) {
    throw Object.assign(new Error('Unsupported vault scan transport'), { code: 'VAULT_TRANSPORT_INVALID' })
  }

  if (transport === FILESYSTEM_TRANSPORT) {
    return (vaultPath, options = {}) => summarizeFilesystemScan(vaultPath, options)
  }

  const endpoint = env.TOLARIA_FILESTATION_ENDPOINT?.trim()
  const vaultMap = parseVaultMap(env.TOLARIA_FILESTATION_VAULTS)
  const provideSession = sessionProvider ?? createEphemeralSessionProvider(env)
  if (!endpoint || Object.keys(vaultMap).length === 0) {
    throw Object.assign(new Error('FileStation endpoint and vault mapping are required'), { code: 'FILESTATION_CONFIG_REQUIRED' })
  }

  return async (vaultPath, options = {}) => {
    const remoteVaultPath = vaultMap[vaultPath]
    if (!remoteVaultPath) throw Object.assign(new Error('Active vault has no FileStation mapping'), { code: 'FILESTATION_VAULT_UNMAPPED' })
    const sid = await provideSession()
    let noteCount = 0
    for await (const ignored of streamFileStationMarkdownFiles({
      endpoint, sid, vaultPath: remoteVaultPath, fetchImpl,
      signal: options.signal, deadline: options.deadline,
      onProgress: options.onProgress, onSkip: options.onSkip,
    })) {
      void ignored
      noteCount += 1
    }
    return { transport: HTTP_TRANSPORT, noteCount }
  }
}

async function summarizeFilesystemScan(vaultPath, options) {
  let noteCount = 0
  for await (const ignored of streamMarkdownFiles(vaultPath, options)) {
    void ignored
    noteCount += 1
  }
  return { transport: FILESYSTEM_TRANSPORT, noteCount }
}

function parseVaultMap(raw) {
  if (!raw?.trim()) return {}
  let parsed
  try { parsed = JSON.parse(raw) } catch {
    throw Object.assign(new Error('FileStation vault mapping must be valid JSON'), { code: 'FILESTATION_CONFIG_INVALID' })
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw Object.assign(new Error('FileStation vault mapping must be an object'), { code: 'FILESTATION_CONFIG_INVALID' })
  }
  return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => key.trim() && typeof value === 'string' && value.trim()))
}
