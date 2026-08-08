import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createMcpToolService } from './tool-service.js'
import { createEphemeralSessionProvider, createVaultScanDispatcher } from './vault-scan-transport.js'

describe('vault scan transport dispatch', () => {
  it('uses FileStation HTTP from the actual MCP service without filesystem fallback', async () => {
    const requests = []
    const env = {
      TOLARIA_VAULT_TRANSPORT: 'filestation-http',
      TOLARIA_FILESTATION_ENDPOINT: 'https://nas.invalid:5001',
      TOLARIA_FILESTATION_VAULTS: JSON.stringify({ 'vault-a': '/remote/a', 'vault-b': '/remote/b' }),
    }
    const scanVault = createVaultScanDispatcher({
      env,
      sessionProvider: () => 'ephemeral-session',
      fetchImpl: async (_url, init) => {
        requests.push(init.body.get('folder_path'))
        return { ok: true, json: async () => ({ success: true, data: { total: 1, files: [{ name: 'note.md', isdir: false }] } }) }
      },
    })
    const service = createMcpToolService({ resolveVaultPaths: () => ['vault-a', 'vault-b'], scanVault })
    assert.deepEqual(await service.scanVaults(), {
      vaults: [
        { vaultLabel: 'vault-a', transport: 'filestation-http', noteCount: 1 },
        { vaultLabel: 'vault-b', transport: 'filestation-http', noteCount: 1 },
      ],
    })
    assert.deepEqual(requests, ['/remote/a', '/remote/b'])
  })

  it('fails closed when HTTP mapping or session is absent', async () => {
    assert.throws(() => createVaultScanDispatcher({ env: { TOLARIA_VAULT_TRANSPORT: 'filestation-http' } }), { code: 'FILESTATION_CONFIG_REQUIRED' })
    const dispatch = createVaultScanDispatcher({
      env: {
        TOLARIA_VAULT_TRANSPORT: 'filestation-http',
        TOLARIA_FILESTATION_ENDPOINT: 'https://nas.invalid',
        TOLARIA_FILESTATION_VAULTS: '{"vault-a":"/remote/a"}',
      },
      sessionProvider: () => { throw Object.assign(new Error('auth required'), { code: 'FILESTATION_AUTH_REQUIRED' }) },
    })
    await assert.rejects(() => dispatch('vault-a'), { code: 'FILESTATION_AUTH_REQUIRED' })
  })

  it('keeps the session only in process memory and removes it from the environment', () => {
    const env = { TOLARIA_FILESTATION_SID: 'secret' }
    const provide = createEphemeralSessionProvider(env)
    assert.equal(env.TOLARIA_FILESTATION_SID, undefined)
    assert.equal(provide(), 'secret')
    assert.equal(provide(), 'secret')
  })
})
