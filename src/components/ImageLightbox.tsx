import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { translate, type AppLocale } from '../lib/i18n'
import type { ImageLightboxTarget } from '../utils/imageLightboxTarget'

type ImageLightboxProps = {
  image: ImageLightboxTarget | null
  locale?: AppLocale
  onClose: () => void
}

export function ImageLightbox({ image, locale = 'en', onClose }: ImageLightboxProps) {
  const title = translate(locale, 'editor.imageLightbox.title')
  const open = image !== null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent
        aria-describedby={undefined}
        data-testid="image-lightbox"
        className="flex max-h-[90vh] max-w-[90vw] items-center justify-center border-none bg-transparent p-0 shadow-none sm:max-w-[90vw]"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {image && (
          <img
            data-testid="image-lightbox-image"
            src={image.src}
            alt={image.alt || title}
            className="max-h-[90vh] max-w-[90vw] rounded-md object-contain shadow-2xl"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
