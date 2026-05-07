import { createElement, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { normalizeExternalUrl } from '../utils/url'
import {
  createCloseHandler,
  createOpenChangeHandler,
  createSubmitHandler,
  createUrlChangeHandler,
} from './newNoteFromUrlDialogHandlers'

interface NewNoteFromUrlDialogProps {
  open: boolean
  locale?: AppLocale
  onClose: () => void
  onImport: (url: string) => boolean | Promise<boolean>
}

export function NewNoteFromUrlDialog({
  open,
  locale = 'en',
  onClose,
  onImport,
}: NewNoteFromUrlDialogProps) {
  const t = useMemo(() => createTranslator(locale), [locale])
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const canSubmit = Boolean(normalizeExternalUrl(url)) && !importing
  const closeDialog = createCloseHandler(onClose, { setUrl, setError, setImporting })
  const handleSubmit = createSubmitHandler({ url, t, onImport, onClose: closeDialog, setError, setImporting })
  const handleOpenChange = createOpenChangeHandler(importing, closeDialog)
  const handleUrlChange = createUrlChangeHandler({ error, setUrl, setError })

  return createElement(
    Dialog,
    { open, onOpenChange: handleOpenChange },
    createElement(
      DialogContent,
      { showCloseButton: false, className: 'sm:max-w-[420px]' },
      createElement(
        DialogHeader,
        null,
        createElement(DialogTitle, null, t('urlImport.title')),
        createElement(DialogDescription, null, t('urlImport.description')),
      ),
      createElement(
        'form',
        { onSubmit: handleSubmit, className: 'space-y-4' },
        createElement(
          'div',
          { className: 'space-y-1.5' },
          createElement(
            'label',
            { htmlFor: 'new-note-from-url-input', className: 'text-xs font-medium text-muted-foreground' },
            t('urlImport.urlLabel'),
          ),
          createElement(Input, {
            id: 'new-note-from-url-input',
            autoFocus: true,
            inputMode: 'url',
            placeholder: t('urlImport.placeholder'),
            value: url,
            'aria-invalid': Boolean(error),
            'aria-describedby': error ? 'new-note-from-url-error' : undefined,
            disabled: importing,
            onChange: handleUrlChange,
          }),
          error
            ? createElement(
              'p',
              { id: 'new-note-from-url-error', className: 'text-xs text-destructive' },
              error,
            )
            : null,
        ),
        createElement(
          DialogFooter,
          null,
          createElement(
            Button,
            { type: 'button', variant: 'outline', disabled: importing, onClick: closeDialog },
            t('urlImport.cancel'),
          ),
          createElement(
            Button,
            { type: 'submit', disabled: !canSubmit },
            importing ? t('urlImport.importing') : t('urlImport.submit'),
          ),
        ),
      ),
    ),
  )
}
