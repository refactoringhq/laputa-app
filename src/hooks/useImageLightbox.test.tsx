import { act, fireEvent, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { useImageLightbox } from './useImageLightbox'

const { trackInlineImageLightboxOpenedMock } = vi.hoisted(() => ({
  trackInlineImageLightboxOpenedMock: vi.fn(),
}))

vi.mock('../lib/productAnalytics', () => ({
  trackInlineImageLightboxOpened: trackInlineImageLightboxOpenedMock,
}))

function createHookTarget() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const ref = createRef<HTMLDivElement>()
  ref.current = container
  const view = renderHook(() => useImageLightbox({ containerRef: ref }))

  return { container, view }
}

function appendImage(container: HTMLElement, src = 'https://example.com/photo.png') {
  const img = document.createElement('img')
  img.src = src
  img.alt = 'Preview target'
  container.appendChild(img)
  return img
}

beforeEach(() => {
  document.body.replaceChildren()
  trackInlineImageLightboxOpenedMock.mockClear()
})

describe('useImageLightbox', () => {
  it('opens the image lightbox on image double-click', () => {
    const { container, view } = createHookTarget()
    const img = appendImage(container)

    fireEvent.doubleClick(img)

    expect(view.result.current.image).toEqual({
      src: 'https://example.com/photo.png',
      alt: 'Preview target',
    })
    expect(trackInlineImageLightboxOpenedMock).toHaveBeenCalledTimes(1)
  })

  it('opens before BlockNote can stop the double-click from bubbling', () => {
    const { container, view } = createHookTarget()
    const img = appendImage(container)
    img.addEventListener('dblclick', (event) => event.stopPropagation())

    fireEvent.doubleClick(img)

    expect(view.result.current.image?.src).toBe('https://example.com/photo.png')
    expect(trackInlineImageLightboxOpenedMock).toHaveBeenCalledTimes(1)
  })

  it('leaves single-click image selection alone', () => {
    const { container, view } = createHookTarget()
    const img = appendImage(container)

    fireEvent.click(img)

    expect(view.result.current.image).toBeNull()
    expect(trackInlineImageLightboxOpenedMock).not.toHaveBeenCalled()
  })

  it('ignores double-clicks on non-image targets', () => {
    const { container, view } = createHookTarget()
    const text = document.createElement('span')
    container.appendChild(text)

    fireEvent.doubleClick(text)

    expect(view.result.current.image).toBeNull()
    expect(trackInlineImageLightboxOpenedMock).not.toHaveBeenCalled()
  })

  it('closes the current lightbox image', () => {
    const { container, view } = createHookTarget()
    const img = appendImage(container)

    fireEvent.doubleClick(img)
    act(() => {
      view.result.current.close()
    })

    expect(view.result.current.image).toBeNull()
  })
})
