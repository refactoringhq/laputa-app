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

function requestBody(init?: RequestInit) {
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function mockNoteContentFetch(content: string) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    if (url === '/api/vault/ping') {
      return jsonResponse({ ok: true })
    }
    if (url === '/api/vault/content') {
      expect(requestBody(init)).toEqual({ path: '/fixture/alpha.md' })
      return jsonResponse({ content })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
  globalThis.fetch = fetchMock as typeof fetch
  return fetchMock
}

describe('tryVaultApi', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    globalThis.fetch = originalFetch
  })

  it('retries vault API discovery after an unavailable response', async () => {
    let vaultApiOnline = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url === '/api/vault/ping') {
        return jsonResponse({ ok: vaultApiOnline }, vaultApiOnline ? 200 : 503)
      }
      if (url === '/api/vault/list') {
        expect(requestBody(init)).toEqual({ path: '/fixture', reload: false })
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
    const fetchMock = mockNoteContentFetch('# Alpha Project')
    const { tryVaultApi } = await import('./vault-api')

    await expect(tryVaultApi('get_note_content', { path: '/fixture/alpha.md' })).resolves.toBe('# Alpha Project')
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/vault/ping')).toHaveLength(1)
  })

  it('validates cached note content through the vault API', async () => {
    mockNoteContentFetch('# Alpha Project')
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

  it('accepts nested Tauri command args when routing browser vault API writes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url === '/api/vault/ping') {
        return jsonResponse({ ok: true })
      }
      if (url === '/api/vault/rename') {
        expect(requestBody(init)).toEqual({
          old_path: '/fixture/untitled-note-123.md',
          new_title: 'Fresh Title',
          vault_path: '/fixture',
        })
        return jsonResponse({ new_path: '/fixture/fresh-title.md', updated_files: 0 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    globalThis.fetch = fetchMock as typeof fetch

    const { tryVaultApi } = await import('./vault-api')

    await expect(tryVaultApi('rename_note', {
      args: {
        old_path: '/fixture/untitled-note-123.md',
        new_title: 'Fresh Title',
        vault_path: '/fixture',
      },
    })).resolves.toEqual({ new_path: '/fixture/fresh-title.md', updated_files: 0 })
  })
})
