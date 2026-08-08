const DEFAULT_PAGE_SIZE = 500
const SKIPPED_NAMES = new Set(['#recycle', '$recycle.bin', '000_개인폴더', '_system', 'system volume information', '@eadir'])
const EXPECTED_PERMISSION_API_CODES = new Set([408])

export async function* streamFileStationMarkdownFiles(options) {
  const { endpoint, sid, vaultPath, fetchImpl = fetch, signal, deadline, now = Date.now } = options
  if (!isSecureHttpUrl(endpoint)) {
    throw Object.assign(new Error('FileStation endpoint must use HTTPS'), { code: 'FILESTATION_TLS_REQUIRED' })
  }
  if (!sid || !vaultPath) throw new Error('FileStation session and vault path are required')

  const pageSize = Math.max(1, Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, 1000))
  const pendingDirectories = [{ path: vaultPath, root: true }]
  let entriesSeen = 0
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop()
    let offset = 0
    let total = Number.POSITIVE_INFINITY
    while (offset < total) {
      assertActive({ signal, deadline, now })
      const body = new URLSearchParams({
        api: 'SYNO.FileStation.List', version: '2', method: 'list',
        folder_path: directory.path, offset: String(offset), limit: String(pageSize),
        additional: '["type"]', _sid: sid,
      })
      const response = await fetchImpl(new URL('/webapi/entry.cgi', endpoint), {
        method: 'POST', signal, redirect: 'error', body,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      })
      if (!response.ok) throw Object.assign(new Error('FileStation HTTP request failed'), { code: 'FILESTATION_HTTP', status: response.status })
      const payload = await response.json()
      if (!payload?.success || !Array.isArray(payload?.data?.files)) {
        const apiCode = payload?.error?.code
        if (!directory.root && EXPECTED_PERMISSION_API_CODES.has(apiCode)) {
          options.onSkip?.({ type: 'scan_skip', reason: 'expected_permission', code: apiCode })
          break
        }
        throw Object.assign(new Error('FileStation API request failed'), { code: 'FILESTATION_API', apiCode })
      }
      total = Number.isFinite(payload.data.total) ? payload.data.total : offset + payload.data.files.length
      for (const entry of payload.data.files) {
        entriesSeen += 1
        if (typeof entry.name !== 'string' || entry.name.startsWith('.') || SKIPPED_NAMES.has(entry.name.toLowerCase())) continue
        if (entry.isdir) {
          if (typeof entry.path === 'string') pendingDirectories.push({ path: entry.path, root: false })
        } else if (entry.name.toLowerCase().endsWith('.md')) {
          yield { name: entry.name }
        }
      }
      offset += payload.data.files.length
      options.onProgress?.({ type: 'scan_progress', entriesSeen, directoriesPending: pendingDirectories.length })
      if (payload.data.files.length === 0 && offset < total) {
        throw Object.assign(new Error('FileStation pagination made no progress'), { code: 'FILESTATION_STALLED' })
      }
    }
  }
}

function assertActive({ signal, deadline, now }) {
  if (signal?.aborted) throw Object.assign(new Error('scan cancelled'), { code: 'ABORT_ERR' })
  const deadlineMs = deadline instanceof Date ? deadline.getTime() : deadline
  if (Number.isFinite(deadlineMs) && now() >= deadlineMs) {
    throw Object.assign(new Error('scan deadline exceeded'), { code: 'SCAN_DEADLINE' })
  }
}

function isSecureHttpUrl(value) {
  try { return new URL(value).protocol === 'https:' } catch { return false }
}
