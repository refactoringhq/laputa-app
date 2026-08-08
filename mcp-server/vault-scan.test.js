import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { findMarkdownFiles } from './vault-scan.js'

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
})

function dir(name) { return { name, isDirectory: () => true } }
function file(name) { return { name, isDirectory: () => false } }
async function* asyncEntries(entries) { yield* entries }
