import { createHash } from 'node:crypto'
import { opendir } from 'node:fs/promises'
import path from 'node:path'

import { findMarkdownFiles } from './vault-scan.js'

const roots = JSON.parse(process.env.TOLARIA_E2E_ROOTS_JSON ?? '[]')
if (!Array.isArray(roots) || roots.length < 1 || roots.length > 2 || roots.some((root) => typeof root !== 'string')) {
  throw new Error('one or two vault roots are required')
}

const protectedNames = new Set([
  '#recycle', '$recycle.bin', '000_개인폴더', '_system', 'system volume information', '@eadir',
])

const summaries = []
for (const [index, root] of roots.entries()) {
  let protectedEntriesSeen = 0
  let entriesSeen = 0
  const skips = []
  const progress = setInterval(() => {
    process.stderr.write(`${JSON.stringify({ vault: index + 1, entriesSeen })}\n`)
  }, 20_000)
  const files = await findMarkdownFiles(root, {
    async openDirectory(directory) {
      const handle = await opendir(directory)
      return {
        async *[Symbol.asyncIterator]() {
          for await (const entry of handle) {
            entriesSeen += 1
            if (entry.name.startsWith('.') || protectedNames.has(entry.name.toLowerCase())) {
              protectedEntriesSeen += 1
            }
            yield entry
          }
        },
      }
    },
    onSkip(event) {
      skips.push(event)
    },
  })
  clearInterval(progress)

  const relativeNames = files.map((file) => path.relative(root, file)).sort()
  const digest = createHash('sha256').update(relativeNames.join('\n')).digest('hex')
  summaries.push({
    vault: index + 1,
    markdownCount: files.length,
    resultHash: digest,
    protectedEntriesSeen,
    expectedPermissionSkips: skips.filter((event) => event.reason === 'expected_permission').length,
    sanitizedEvents: skips.every((event) => Object.keys(event).sort().join(',') === 'code,reason,type'),
  })
}

console.log(JSON.stringify({ vaultCount: summaries.length, vaults: summaries }))
