import type { createTranslator } from '../lib/i18n'
import { Button } from './ui/button'

type Translate = ReturnType<typeof createTranslator>

export function SettingsFooter({
  onClose,
  onSave,
  t,
}: {
  onClose: () => void
  onSave: () => void
  t: Translate
}) {
  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{ height: 56, padding: '0 24px', borderTop: '1px solid var(--border)' }}
    >
      <span style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>{t('settings.footerShortcut')}</span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          {t('settings.cancel')}
        </Button>
        <Button size="sm" onClick={onSave} data-testid="settings-save">
          {t('settings.save')}
        </Button>
      </div>
    </div>
  )
}
