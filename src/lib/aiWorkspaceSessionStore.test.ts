import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'tolaria:ai-workspace-sessions:v1'

function createStorageMock() {
  const store = new Map<string, string>()
  let writesFail = false

  return {
    storage: {
      get length() {
        return store.size
      },
      clear: vi.fn(() => store.clear()),
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        store.delete(key)
      }),
      setItem: vi.fn((key: string, value: string) => {
        if (writesFail) throw new Error('Quota exceeded')
        store.set(key, value)
      }),
    } as Storage,
    failWrites() {
      writesFail = true
    },
  }
}

describe('aiWorkspaceSessionStore', () => {
  let storageMock: ReturnType<typeof createStorageMock>

  beforeEach(() => {
    storageMock = createStorageMock()
    vi.stubGlobal('localStorage', storageMock.storage)
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('hydrates workspace session messages after module reload', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      'chat-1': {
        messages: [
          {
            userMessage: 'Remember this',
            actions: [],
            response: 'Still here',
            id: 'message-1',
          },
        ],
        status: 'done',
      },
    }))

    const store = await import('./aiWorkspaceSessionStore')

    expect(store.aiWorkspaceSessionSnapshot('chat-1')).toEqual({
      messages: [
        expect.objectContaining({
          userMessage: 'Remember this',
          response: 'Still here',
        }),
      ],
      status: 'done',
    })
  })

  it('restores interrupted stored sessions as idle completed history', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      'chat-1': {
        messages: [
          {
            userMessage: 'Halfway',
            actions: [],
            response: 'Partial',
            isStreaming: true,
            id: 'message-1',
          },
        ],
        status: 'thinking',
      },
    }))

    const store = await import('./aiWorkspaceSessionStore')

    expect(store.aiWorkspaceSessionSnapshot('chat-1')).toEqual({
      messages: [
        expect.objectContaining({
          userMessage: 'Halfway',
          response: 'Partial',
          isStreaming: false,
        }),
      ],
      status: 'idle',
    })
  })

  it('keeps in-memory session history when localStorage persistence fails', async () => {
    const store = await import('./aiWorkspaceSessionStore')
    storageMock.failWrites()

    store.setAiWorkspaceSessionMessages('chat-1', [
      {
        userMessage: 'Still available',
        actions: [],
        response: 'In memory',
        id: 'message-1',
      },
    ])

    expect(store.aiWorkspaceSessionSnapshot('chat-1').messages).toEqual([
      expect.objectContaining({
        userMessage: 'Still available',
        response: 'In memory',
      }),
    ])
  })
})
