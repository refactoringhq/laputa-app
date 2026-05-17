import { describe, expect, it, vi } from 'vitest'

describe('test setup fetch mock isolation', () => {
  it('allows a test to override the shared fetch mock', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 200 }))

    await expect(fetch('/override').then((response) => response.status)).resolves.toBe(200)
  })

  it('restores the default fetch mock after each test', async () => {
    await expect(fetch('/default').then((response) => response.status)).resolves.toBe(418)
  })
})
