import { describe, expect, it } from 'vitest'
import { getDoubleClickedImageTarget } from './imageLightboxTarget'

describe('getDoubleClickedImageTarget', () => {
  it('returns the src and alt when the target is an image element with a src', () => {
    const img = document.createElement('img')
    img.src = 'https://example.com/cat.png'
    img.alt = 'Sleeping cat'

    expect(getDoubleClickedImageTarget(img)).toEqual({
      src: 'https://example.com/cat.png',
      alt: 'Sleeping cat',
    })
  })

  it('returns an empty alt when the image has no alt text', () => {
    const img = document.createElement('img')
    img.src = 'https://example.com/cat.png'

    expect(getDoubleClickedImageTarget(img)).toEqual({
      src: 'https://example.com/cat.png',
      alt: '',
    })
  })

  it('returns null when the target is an image element without a src', () => {
    const img = document.createElement('img')

    expect(getDoubleClickedImageTarget(img)).toBeNull()
  })

  it('returns null when the target is not an image element', () => {
    const div = document.createElement('div')

    expect(getDoubleClickedImageTarget(div)).toBeNull()
  })

  it('returns the nested BlockNote image when the wrapper is double-clicked', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'bn-visual-media-wrapper'
    const img = document.createElement('img')
    img.src = 'https://example.com/wrapped.png'
    img.alt = 'Wrapped image'
    wrapper.appendChild(img)

    expect(getDoubleClickedImageTarget(wrapper)).toEqual({
      src: 'https://example.com/wrapped.png',
      alt: 'Wrapped image',
    })
  })

  it('ignores caption and resize controls inside image blocks', () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'bn-visual-media-wrapper'
    const img = document.createElement('img')
    img.src = 'https://example.com/wrapped.png'
    const caption = document.createElement('figcaption')
    caption.className = 'bn-file-caption'
    const resizeHandle = document.createElement('div')
    resizeHandle.className = 'bn-resize-handle'
    wrapper.append(img, caption, resizeHandle)

    expect(getDoubleClickedImageTarget(caption)).toBeNull()
    expect(getDoubleClickedImageTarget(resizeHandle)).toBeNull()
  })

  it('returns null when the target is null', () => {
    expect(getDoubleClickedImageTarget(null)).toBeNull()
  })

  it('ignores tracking pixel images smaller than the visibility threshold', () => {
    const img = document.createElement('img')
    img.src = 'https://example.com/pixel.gif'
    Object.defineProperty(img, 'naturalWidth', { value: 1, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 1, configurable: true })

    expect(getDoubleClickedImageTarget(img)).toBeNull()
  })

  it('allows unloaded images whose natural dimensions are still unknown', () => {
    const img = document.createElement('img')
    img.src = 'https://example.com/loading.png'
    Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 0, configurable: true })

    expect(getDoubleClickedImageTarget(img)?.src).toBe('https://example.com/loading.png')
  })
})
