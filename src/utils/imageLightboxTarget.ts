export type ImageLightboxTarget = {
  src: string
  alt: string
}

const MIN_VIEWABLE_DIMENSION = 16
const IMAGE_WRAPPER_SELECTOR = '.bn-visual-media-wrapper'
const IMAGE_INTERACTION_IGNORE_SELECTOR = [
  '.bn-file-caption',
  '.bn-resize-handle',
  '.bn-add-file-button',
  '.bn-file-name-with-icon',
  'button',
  '[role="button"]',
].join(', ')

export function getDoubleClickedImageTarget(target: EventTarget | null): ImageLightboxTarget | null {
  const image = resolveImageElement(target)
  if (!image?.src) return null
  if (isTooSmallToView(image)) return null

  return {
    src: image.src,
    alt: image.getAttribute('alt')?.trim() ?? '',
  }
}

function resolveImageElement(target: EventTarget | null): HTMLImageElement | null {
  if (target instanceof HTMLImageElement) return target
  if (!(target instanceof HTMLElement)) return null
  if (target.closest(IMAGE_INTERACTION_IGNORE_SELECTOR)) return null
  return imageInWrapper(target.closest(IMAGE_WRAPPER_SELECTOR))
}

function imageInWrapper(wrapper: Element | null): HTMLImageElement | null {
  if (!(wrapper instanceof HTMLElement)) return null
  const image = wrapper.querySelector('img')
  if (!(image instanceof HTMLImageElement)) return null
  return image
}

function isTooSmallToView(image: HTMLImageElement): boolean {
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width === 0 && height === 0) return false
  return width < MIN_VIEWABLE_DIMENSION && height < MIN_VIEWABLE_DIMENSION
}
