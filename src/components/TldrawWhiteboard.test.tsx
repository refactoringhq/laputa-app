import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from 'tldraw'
import { TldrawWhiteboard } from './TldrawWhiteboard'

interface MockTldrawProps {
  assetUrls: MockAssetUrls
  onMount: (editor: Editor) => () => void
  user?: MockTldrawUser
}

interface MockTldrawUser {
  userPreferences: {
    get: () => { colorScheme?: string }
  }
}

interface MockAssetUrls {
  embedIcons: Record<string, string>
  fonts: Record<string, string>
  icons: Record<string, string>
  translations: Record<string, string>
}

const tldrawMock = vi.hoisted(() => ({
  Tldraw: vi.fn(),
}))

const tldrawStoreMock = vi.hoisted(() => ({
  createTLStore: vi.fn(() => ({
    document: { records: {} },
    listen: vi.fn(() => vi.fn()),
  })),
  getSnapshot: vi.fn((store: { document?: unknown }) => ({ document: store.document ?? { records: {} } })),
  loadSnapshot: vi.fn((store: { document?: unknown }, snapshot: unknown) => {
    store.document = snapshot
  }),
}))

const assetImportMock = vi.hoisted(() => ({
  getAssetUrlsByImport: vi.fn((formatAssetUrl: (assetUrl?: string) => string) => ({
    embedIcons: {},
    fonts: {
      tldraw_draw: formatAssetUrl('/assets/Shantell_Sans-Informal_Regular.woff2'),
    },
    icons: {
      'tool-pencil': `${formatAssetUrl('/assets/0_merged.svg')}#tool-pencil`,
    },
    translations: {
      en: formatAssetUrl(undefined),
    },
  })),
}))

vi.mock('@tldraw/assets/imports.vite', () => assetImportMock)

vi.mock('tldraw', async () => {
  const { createElement } = await import('react')

  tldrawMock.Tldraw.mockImplementation(({ assetUrls }: MockTldrawProps) =>
    createElement('div', {
      'data-testid': 'mock-tldraw',
      'data-draw-font-url': assetUrls.fonts.tldraw_draw,
    })
  )

  return {
    Box: class Box {
      x: number
      y: number
      w: number
      h: number

      constructor(x: number, y: number, w: number, h: number) {
        this.x = x
        this.y = y
        this.w = w
        this.h = h
      }
    },
    Tldraw: tldrawMock.Tldraw,
    createTLStore: tldrawStoreMock.createTLStore,
    defaultUserPreferences: {
      colorScheme: 'light',
      locale: 'en',
    },
    getSnapshot: tldrawStoreMock.getSnapshot,
    loadSnapshot: tldrawStoreMock.loadSnapshot,
    useTldrawUser: vi.fn(({ userPreferences }: { userPreferences: { colorScheme: string } }) => ({
      setUserPreferences: vi.fn(),
      userPreferences: {
        get: () => userPreferences,
      },
    })),
  }
})

function renderedTldrawAssetUrls(): MockAssetUrls {
  const props = tldrawMock.Tldraw.mock.calls[0]?.[0] as MockTldrawProps
  expect(props.assetUrls).toBeDefined()
  return props.assetUrls
}

function renderedTldrawProps(): MockTldrawProps {
  const props = tldrawMock.Tldraw.mock.lastCall?.[0] as MockTldrawProps
  expect(props).toBeDefined()
  return props
}

function mockEditor(): Editor {
  const container = document.createElement('div')
  const canvas = document.createElement('div')
  canvas.className = 'tl-canvas'
  container.append(canvas)

  return {
    dispatch: vi.fn(),
    getContainer: vi.fn(() => container),
    textMeasure: {
      measureElementTextNodeSpans: vi.fn(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'top')")
      }),
    },
    updateViewportScreenBounds: vi.fn(),
  } as unknown as Editor
}

function measuredTextElement(): HTMLElement {
  const element = document.createElement('div')
  element.textContent = 'Label'
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({
    height: 24,
    width: 88,
  }))
  return element
}

function expectNoCdnUrls(urls: Record<string, string>) {
  Object.values(urls).forEach((url) => {
    expect(url).not.toContain('cdn.tldraw.com')
  })
}

function expectBundledTldrawAssetUrls(assetUrls: MockAssetUrls) {
  expect(assetUrls.fonts.tldraw_draw).toContain('Shantell_Sans-Informal_Regular.woff2')
  expect(assetUrls.icons['tool-pencil']).toContain('0_merged.svg#tool-pencil')
  expect(assetUrls.translations.en).toBe('data:application/json;base64,e30K')
  expectNoCdnUrls(assetUrls.fonts)
  expectNoCdnUrls(assetUrls.icons)
  expectNoCdnUrls(assetUrls.translations)
}

describe('TldrawWhiteboard', () => {
  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.classList.remove('dark')
    vi.clearAllMocks()
  })

  it('uses bundled tldraw assets instead of CDN URLs', () => {
    render(
      <TldrawWhiteboard
        boardId="board-1"
        height="520"
        snapshot=""
        width=""
        onSizeChange={vi.fn()}
        onSnapshotChange={vi.fn()}
      />
    )

    expect(screen.getByTestId('mock-tldraw')).toHaveAttribute('data-draw-font-url')
    expect(assetImportMock.getAssetUrlsByImport).toHaveBeenCalledWith(expect.any(Function))
    expectBundledTldrawAssetUrls(renderedTldrawAssetUrls())
  })

  it('passes Tolaria dark mode to tldraw', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.documentElement.classList.add('dark')

    render(
      <TldrawWhiteboard
        boardId="board-1"
        height="520"
        snapshot=""
        width=""
        onSizeChange={vi.fn()}
        onSnapshotChange={vi.fn()}
      />
    )

    expect(renderedTldrawProps().user?.userPreferences.get().colorScheme).toBe('dark')
  })

  it('updates the tldraw color scheme when Tolaria theme changes', async () => {
    document.documentElement.setAttribute('data-theme', 'light')

    render(
      <TldrawWhiteboard
        boardId="board-1"
        height="520"
        snapshot=""
        width=""
        onSizeChange={vi.fn()}
        onSnapshotChange={vi.fn()}
      />
    )

    expect(renderedTldrawProps().user?.userPreferences.get().colorScheme).toBe('light')

    act(() => {
      document.documentElement.setAttribute('data-theme', 'dark')
      document.documentElement.classList.add('dark')
    })

    await waitFor(() => {
      expect(renderedTldrawProps().user?.userPreferences.get().colorScheme).toBe('dark')
    })
  })

  it('installs the text measurement guard when the canvas mounts', () => {
    render(
      <TldrawWhiteboard
        boardId="board-1"
        height="520"
        snapshot=""
        width=""
        onSizeChange={vi.fn()}
        onSnapshotChange={vi.fn()}
      />
    )

    const editor = mockEditor()
    const cleanup = renderedTldrawProps().onMount(editor)

    expect(editor.textMeasure.measureElementTextNodeSpans(measuredTextElement())).toEqual({
      didTruncate: false,
      spans: [{
        box: { h: 24, w: 88, x: 0, y: 0 },
        text: 'Label',
      }],
    })

    cleanup()
    expect(() => editor.textMeasure.measureElementTextNodeSpans(measuredTextElement())).toThrow('top')
  })

  it('resets the drawing store when switching to a blank board snapshot', () => {
    const boardASnapshot = { records: { shape: 'from-board-a' } }
    const { rerender } = render(
      <TldrawWhiteboard
        boardId="board-1"
        height="520"
        snapshot={JSON.stringify(boardASnapshot)}
        width=""
        onSizeChange={vi.fn()}
        onSnapshotChange={vi.fn()}
      />
    )

    expect(tldrawStoreMock.loadSnapshot).toHaveBeenLastCalledWith(expect.any(Object), boardASnapshot)

    rerender(
      <TldrawWhiteboard
        boardId="board-2"
        height="520"
        snapshot=""
        width=""
        onSizeChange={vi.fn()}
        onSnapshotChange={vi.fn()}
      />
    )

    expect(tldrawStoreMock.loadSnapshot).toHaveBeenLastCalledWith(expect.any(Object), { records: {} })
  })
})
