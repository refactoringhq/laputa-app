import { opendir } from 'node:fs/promises'
import path from 'node:path'

const SKIPPED_SCAN_NAMES = new Set([
  '#recycle', '$recycle.bin', '000_개인폴더', '_system', 'system volume information', '@eadir',
])
const EXPECTED_PERMISSION_CODES = new Set(['EACCES', 'EPERM'])

export async function findMarkdownFiles(dir, options = {}) {
  const results = []
  for await (const file of streamMarkdownFiles(dir, options)) results.push(file)
  return results
}

export async function* streamMarkdownFiles(dir, options = {}) {
  const state = createScanState(options)
  yield* scanDirectory(dir, options, false, state)
}

export async function* streamMarkdownBatches(dir, options = {}) {
  const batchSize = Math.max(1, options.batchSize ?? 250)
  let batch = []
  for await (const file of streamMarkdownFiles(dir, options)) {
    batch.push(file)
    if (batch.length === batchSize) {
      yield batch
      batch = []
    }
  }
  if (batch.length > 0) yield batch
}

async function* scanDirectory(dir, options, permissionCanBeSkipped, state) {
  assertActive(state)
  const openDirectory = options.openDirectory ?? opendir
  let items
  try {
    items = await openDirectory(dir)
  } catch (error) {
    if (!permissionCanBeSkipped || !EXPECTED_PERMISSION_CODES.has(error?.code)) throw error
    options.onSkip?.({ type: 'scan_skip', reason: 'expected_permission', code: error.code })
    return
  }

  for await (const item of items) {
    assertActive(state)
    state.entriesSeen += 1
    if (state.entriesSeen % state.progressEvery === 0) {
      options.onProgress?.({ type: 'scan_progress', entriesSeen: state.entriesSeen, filesSeen: state.filesSeen })
    }
    if (item.name.startsWith('.') || SKIPPED_SCAN_NAMES.has(item.name.toLowerCase())) continue
    const full = resolveInside(dir, item.name)
    if (!full) continue
    if (item.isDirectory()) {
      yield* scanDirectory(full, options, true, state)
    } else if (item.name.endsWith('.md')) {
      state.filesSeen += 1
      yield full
    }
  }
}

function createScanState(options) {
  const deadline = options.deadline instanceof Date ? options.deadline.getTime() : options.deadline
  return {
    signal: options.signal,
    deadline: Number.isFinite(deadline) ? deadline : Number.POSITIVE_INFINITY,
    now: options.now ?? Date.now,
    progressEvery: Math.max(1, options.progressEvery ?? 1000),
    entriesSeen: 0,
    filesSeen: 0,
  }
}

function assertActive(state) {
  if (state.signal?.aborted) throw Object.assign(new Error('scan cancelled'), { code: 'ABORT_ERR' })
  if (state.now() >= state.deadline) throw Object.assign(new Error('scan deadline exceeded'), { code: 'SCAN_DEADLINE' })
}

function resolveInside(root, target) {
  const resolved = path.resolve(root, target)
  const relative = path.relative(root, resolved)
  return !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null
}
