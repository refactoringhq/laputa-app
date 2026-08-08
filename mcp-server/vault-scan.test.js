import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { findMarkdownFiles, streamMarkdownFiles } from './vault-scan.js'
import { streamFileStationMarkdownFiles } from './filestation-scan.js'

describe('NAS vault scan boundaries', () => {
  it('reproduces two vaults three times while skipping protected children', async () => {
    const events = []
    const root = path.resolve('nas-fixture')
    const entries = new Map([
      [root, [dir('#RECYCLE'), dir('_SYSTEM'), dir('.hidden'), dir('000_개인폴더'), dir('denied'), dir('vault-a'), dir('vault-b')]],
      [path.join(root, 'vault-a'), [file('a.md')]],
      [path.join(root, 'vault-b'), [file('b.md')]],
    ])
    const openDirectory = async target => {
      if (target.endsWith(`${path.sep}denied`)) throw Object.assign(new Error('denied'), { code: 'EACCES' })
      return asyncEntries(entries.get(target) ?? [])
    }

    for (let run = 0; run < 3; run += 1) {
      const files = await findMarkdownFiles(root, { openDirectory, onSkip: event => events.push(event) })
      assert.deepEqual(files.map(filePath => path.basename(filePath)).sort(), ['a.md', 'b.md'])
    }
    assert.equal(events.filter(event => event.reason === 'expected_permission').length, 3)
    assert.ok(events.every(event => !('path' in event)))
  })

  it('does not downgrade unexpected I/O to an expected permission event', async () => {
    const root = path.resolve('nas-io-fixture')
    const openDirectory = async target => {
      if (target === root) return asyncEntries([dir('broken')])
      throw Object.assign(new Error('device failure'), { code: 'EIO' })
    }
    await assert.rejects(() => findMarkdownFiles(root, { openDirectory }), { code: 'EIO' })
  })

  it('does not downgrade a vault-root permission failure to a child skip', async () => {
    const events = []
    const openDirectory = async () => {
      throw Object.assign(new Error('root denied'), { code: 'EACCES' })
    }
    await assert.rejects(
      () => findMarkdownFiles(path.resolve('denied-root'), { openDirectory, onSkip: event => events.push(event) }),
      { code: 'EACCES' },
    )
    assert.deepEqual(events, [])
  })

  it('streams results with progress and stops on cancellation or deadline', async () => {
    const root = path.resolve('large-fixture')
    const progress = []
    const openDirectory = async () => asyncEntries(Array.from({ length: 2500 }, (_, index) => file(`${index}.md`)))
    let count = 0
    for await (const ignored of streamMarkdownFiles(root, { openDirectory, progressEvery: 1000, onProgress: event => progress.push(event) })) {
      void ignored
      count += 1
    }
    assert.equal(count, 2500)
    assert.deepEqual(progress.map(event => event.entriesSeen), [1000, 2000])

    await assert.rejects(
      async () => { for await (const ignored of streamMarkdownFiles(root, { openDirectory, deadline: 1, now: () => 1 })) void ignored },
      { code: 'SCAN_DEADLINE' },
    )
  })

  it('paginates FileStation over HTTP without returning raw paths', async () => {
    const requests = []
    const pages = [
      { success: true, data: { total: 3, files: [{ name: 'a.md', isdir: false }, { name: 'folder', isdir: true }] } },
      { success: true, data: { total: 3, files: [{ name: 'b.md', isdir: false }] } },
    ]
    const fetchImpl = async (url, init) => {
      requests.push({ url, body: init.body })
      return { ok: true, json: async () => pages.shift() }
    }
    const files = []
    for await (const entry of streamFileStationMarkdownFiles({
      endpoint: 'https://nas.invalid:5001', sid: 'secret-session', vaultPath: '/private/vault', pageSize: 2, fetchImpl,
    })) files.push(entry)
    assert.deepEqual(files, [{ name: 'a.md' }, { name: 'b.md' }])
    assert.deepEqual(requests.map(request => request.body.get('offset')), ['0', '2'])
    assert.ok(requests.every(request => !request.url.searchParams.has('_sid')))
  })

  it('refuses to send a FileStation session over plaintext HTTP', async () => {
    const iterator = streamFileStationMarkdownFiles({
      endpoint: 'http://nas.invalid:5000', sid: 'secret-session', vaultPath: '/private/vault',
      fetchImpl: async () => { throw new Error('must not send') },
    })
    await assert.rejects(() => iterator.next(), { code: 'FILESTATION_TLS_REQUIRED' })
  })
})

function dir(name) { return { name, isDirectory: () => true } }
function file(name) { return { name, isDirectory: () => false } }
async function* asyncEntries(entries) { yield* entries }
