import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createTranslator, type AppLocale } from '../lib/i18n'
import { normalizeExternalUrl } from '../utils/url'

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

  useEffect(() => {
    if (!open) {
      setUrl('')
      setError(null)
      setImporting(false)
    }
  }, [open])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalized = normalizeExternalUrl(url)
    if (!normalized) {
      setError(t('urlImport.invalidUrl'))
      return
    }

    setImporting(true)
    setError(null)
    try {
      const imported = await onImport(normalized)
      if (imported !== false) onClose()
    } finally {
      setImporting(false)
    }
  }

  const canSubmit = Boolean(normalizeExternalUrl(url)) && !importing

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !importing) onClose() }}>
      <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('urlImport.title')}</DialogTitle>
          <DialogDescription>{t('urlImport.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-note-from-url-input" className="text-xs font-medium text-muted-foreground">
              {t('urlImport.urlLabel')}
            </label>
            <Input
              id="new-note-from-url-input"
              autoFocus
              inputMode="url"
              placeholder={t('urlImport.placeholder')}
              value={url}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'new-note-from-url-error' : undefined}
              disabled={importing}
              onChange={(event) => {
                setUrl(event.target.value)
                if (error) setError(null)
              }}
            />
            {error && (
              <p id="new-note-from-url-error" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={importing} onClick={onClose}>
              {t('urlImport.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {importing ? t('urlImport.importing') : t('urlImport.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
