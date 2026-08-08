import { opendir } from 'node:fs/promises'
import path from 'node:path'

const SKIPPED_SCAN_NAMES = new Set([
  '#recycle', '$recycle.bin', '000_개인폴더', '_system', 'system volume information', '@eadir',
])
const EXPECTED_PERMISSION_CODES = new Set(['EACCES', 'EPERM'])

export async function findMarkdownFiles(dir, options = {}) {
  return scanDirectory(dir, options, false)
}

async function scanDirectory(dir, options, permissionCanBeSkipped) {
  const results = []
  const openDirectory = options.openDirectory ?? opendir
  let items
  try {
    items = await openDirectory(dir)
  } catch (error) {
    if (!permissionCanBeSkipped || !EXPECTED_PERMISSION_CODES.has(error?.code)) throw error
    options.onSkip?.({ type: 'scan_skip', reason: 'expected_permission', code: error.code })
    return results
  }

  for await (const item of items) {
    if (item.name.startsWith('.') || SKIPPED_SCAN_NAMES.has(item.name.toLowerCase())) continue
    const full = resolveInside(dir, item.name)
    if (!full) continue
    if (item.isDirectory()) {
      results.push(...await scanDirectory(full, options, true))
    } else if (item.name.endsWith('.md')) {
      results.push(full)
    }
  }
  return results
}

function resolveInside(root, target) {
  const resolved = path.resolve(root, target)
  const relative = path.relative(root, resolved)
  return !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null
}
