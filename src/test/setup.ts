import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { createElement, type ReactNode, type ComponentType } from 'react'

// Stub fetch to prevent jsdom@28 + Node 22 undici incompatibility.
// jsdom's JSDOMDispatcher passes an onError handler that Node 22's bundled
// undici rejects with InvalidArgumentError (UND_ERR_INVALID_ARG).
// Tests should never make real network requests — individual tests can
// override this stub via vi.mocked(fetch).mockImplementation(...).
globalThis.fetch = vi.fn(() =>
  Promise.resolve(new Response(null, { status: 418 })),
) as typeof globalThis.fetch

// Stub WebSocket to prevent Node 22 + undici WebSocket incompatibility.
// undici's WebSocket dispatchEvent crashes with "The event argument must be
// an instance of Event" when running in jsdom environment.
// Tests should never open real WebSocket connections.
globalThis.WebSocket = class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = MockWebSocket.OPEN
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  constructor(/* url: string, protocols?: string | string[] */) {
    // No-op: don't open real connections in tests
  }
  send(/* data: unknown */) {}
  close() { this.readyState = MockWebSocket.CLOSED }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true }
} as unknown as typeof WebSocket

// Mock scrollIntoView for jsdom (not implemented)
Element.prototype.scrollIntoView = vi.fn()

// Mock ResizeObserver for jsdom (not implemented)
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

// Mock IntersectionObserver for jsdom (not implemented)
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver

// Mock @tauri-apps/plugin-opener for test environment
vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(),
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}))

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

// Mock react-day-picker: Calendar component uses DayPicker which needs real DOM APIs not available in jsdom
vi.mock('react-day-picker', () => ({
  DayPicker: () => null,
  getDefaultClassNames: () => ({}),
}))

function getVirtualizedIndexes(length: number): number[] {
  if (length <= 200) return Array.from({ length }, (_, index) => index)

  const edgeSize = 50
  return [
    ...Array.from({ length: edgeSize }, (_, index) => index),
    ...Array.from({ length: edgeSize }, (_, index) => length - edgeSize + index),
  ]
}

// Mock react-virtuoso: JSDOM has no real viewport, so render a representative window for large lists.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent, components }: {
    data?: unknown[]
    itemContent?: (index: number, item: unknown) => ReactNode
    components?: { Header?: ComponentType }
  }) => {
    const Header = components?.Header
    const resolvedData = data ?? []
    const renderedIndexes = getVirtualizedIndexes(resolvedData.length)
    return createElement('div', { 'data-testid': 'virtuoso-mock' },
      Header ? createElement(Header) : null,
      renderedIndexes.map((index) =>
        createElement('div', { key: index }, itemContent?.(index, resolvedData[index]))
      )
    )
  },
  GroupedVirtuoso: ({ groupCounts, groupContent, itemContent }: {
    groupCounts: number[]
    groupContent: (index: number) => ReactNode
    itemContent: (index: number, groupIndex: number) => ReactNode
  }) => {
    let globalIndex = 0
    return createElement('div', { 'data-testid': 'grouped-virtuoso-mock' },
      groupCounts?.map((count: number, groupIndex: number) => {
        const items = []
        for (let i = 0; i < count; i++) {
          items.push(createElement('div', { key: globalIndex }, itemContent(globalIndex, groupIndex)))
          globalIndex++
        }
        return createElement('div', { key: `group-${groupIndex}` },
          groupContent(groupIndex),
          ...items
        )
      })
    )
  },
}))
