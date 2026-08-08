import { createHash } from 'node:crypto'
import { streamFileStationMarkdownFiles } from './filestation-scan.js'

const configs = JSON.parse(process.env.TOLARIA_FILESTATION_VAULTS_JSON ?? '[]')
if (!Array.isArray(configs) || configs.length !== 2) throw new Error('exactly two HTTP vault configurations are required')

const summaries = []
for (const [index, config] of configs.entries()) {
  const hash = createHash('sha256')
  let markdownCount = 0
  let progressEvents = 0
  for await (const entry of streamFileStationMarkdownFiles({
    ...config,
    deadline: Date.now() + 10 * 60 * 1000,
    onProgress: () => { progressEvents += 1 },
  })) {
    markdownCount += 1
    hash.update(entry.name).update('\0')
  }
  summaries.push({ vault: index + 1, markdownCount, resultHash: hash.digest('hex'), progressEvents })
}
process.stdout.write(`${JSON.stringify({ transport: 'http', vaultCount: summaries.length, vaults: summaries })}\n`)
