import { afterEach, describe, expect, it, vi } from 'vitest'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : String(input)
}

describe('tryVaultApi', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
  })

  it('retries vault API discovery after an unavailable response', async () => {
    let vaultApiOnline = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url === '/api/vault/ping') {
        return jsonResponse({ ok: vaultApiOnline }, vaultApiOnline ? 200 : 503)
      }
      if (url === 'http://localhost:3000/api/vault/list?path=%2Ffixture') {
        return jsonResponse([{ title: 'Alpha Project' }])
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof fetch

    const { tryVaultApi } = await import('./vault-api')

    await expect(tryVaultApi('list_vault', { path: '/fixture' })).resolves.toBeUndefined()

    vaultApiOnline = true

    await expect(tryVaultApi('list_vault', { path: '/fixture' })).resolves.toEqual([{ title: 'Alpha Project' }])
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/vault/ping')).toHaveLength(2)
  })

  it('unwraps note content responses from the vault API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url === '/api/vault/ping') {
        return jsonResponse({ ok: true })
      }
      if (url === 'http://localhost:3000/api/vault/content?path=%2Ffixture%2Falpha.md') {
        return jsonResponse({ content: '# Alpha Project' })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof fetch

    const { tryVaultApi } = await import('./vault-api')

    await expect(tryVaultApi('get_note_content', { path: '/fixture/alpha.md' })).resolves.toBe('# Alpha Project')
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/vault/ping')).toHaveLength(1)
  })

  it('validates cached note content through the vault API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url === '/api/vault/ping') {
        return jsonResponse({ ok: true })
      }
      if (url === 'http://localhost:3000/api/vault/content?path=%2Ffixture%2Falpha.md') {
        return jsonResponse({ content: '# Alpha Project' })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof fetch

    const { tryVaultApi } = await import('./vault-api')

    await expect(tryVaultApi('validate_note_content', {
      path: '/fixture/alpha.md',
      content: '# Alpha Project',
    })).resolves.toBe(true)
    await expect(tryVaultApi('validate_note_content', {
      path: '/fixture/alpha.md',
      content: '# Stale',
    })).resolves.toBe(false)
  })
})
