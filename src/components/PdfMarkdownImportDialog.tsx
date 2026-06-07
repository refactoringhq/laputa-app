import { useState } from 'react'
import type { AppLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'
import type { PdfMarkdownOcrMode } from '../utils/pdfMarkdownImport'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

interface PdfMarkdownImportDialogProps {
  fileTitle?: string
  locale?: AppLocale
  onClose: () => void
  onSubmit: (options: { ocrLanguage: string; ocrMode: PdfMarkdownOcrMode }) => void
  open: boolean
  working?: boolean
}

export function PdfMarkdownImportDialog({
  fileTitle,
  locale = 'en',
  onClose,
  onSubmit,
  open,
  working = false,
}: PdfMarkdownImportDialogProps) {
  const [ocrMode, setOcrMode] = useState<PdfMarkdownOcrMode>('ocr_when_needed')
  const [ocrLanguage, setOcrLanguage] = useState('eng')
  const t = (key: string, params?: Record<string, string>) => translate(locale, key, params)
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !working) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pdfImport.dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('pdfImport.dialog.description', { file: fileTitle ?? t('pdfImport.dialog.untitledFile') })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pdf-import-mode">{t('pdfImport.mode.label')}</label>
            <Select value={ocrMode} onValueChange={(value) => setOcrMode(value as PdfMarkdownOcrMode)} disabled={working}>
              <SelectTrigger id="pdf-import-mode" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text_only">{t('pdfImport.mode.textOnly')}</SelectItem>
                <SelectItem value="ocr_when_needed">{t('pdfImport.mode.ocrWhenNeeded')}</SelectItem>
                <SelectItem value="ocr_all_pages">{t('pdfImport.mode.ocrAllPages')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="pdf-import-language">{t('pdfImport.language.label')}</label>
            <Input id="pdf-import-language" value={ocrLanguage} onChange={(e) => setOcrLanguage(e.target.value)} placeholder={t('pdfImport.language.placeholder')} disabled={working || ocrMode === 'text_only'} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={working}>{t('common.cancel')}</Button>
          <Button type="button" onClick={() => onSubmit({ ocrLanguage, ocrMode })} disabled={working}>
            {working ? t('pdfImport.dialog.working') : t('pdfImport.dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
