import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageLightbox } from './ImageLightbox'

describe('ImageLightbox', () => {
  it('renders the selected image in a dialog', () => {
    render(
      <ImageLightbox
        image={{ src: 'https://example.com/photo.png', alt: 'A lake' }}
        onClose={() => {}}
      />,
    )

    expect(screen.getByTestId('image-lightbox')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'A lake' })).toHaveAttribute('src', 'https://example.com/photo.png')
    expect(screen.getByText('Image preview')).toHaveClass('sr-only')
  })

  it('falls back to localized alt text when the image has no alt', () => {
    render(
      <ImageLightbox
        image={{ src: 'https://example.com/photo.png', alt: '' }}
        locale="zh-CN"
        onClose={() => {}}
      />,
    )

    expect(screen.getByRole('img', { name: '图像预览' })).toBeInTheDocument()
  })

  it('calls onClose when the dialog closes', () => {
    const onClose = vi.fn()
    render(
      <ImageLightbox
        image={{ src: 'https://example.com/photo.png', alt: 'A lake' }}
        onClose={onClose}
      />,
    )

    fireEvent.keyDown(screen.getByTestId('image-lightbox'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
