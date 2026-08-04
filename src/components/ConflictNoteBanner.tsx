import { Warning as AlertTriangle } from '@phosphor-icons/react'
import { translate, type AppLocale } from '../lib/i18n'
import { Button } from './ui/button'

interface ConflictNoteBannerProps {
  onKeepMine: () => void
  onKeepTheirs: () => void
  locale?: AppLocale
}

export function ConflictNoteBanner({ onKeepMine, onKeepTheirs, locale = 'en' }: ConflictNoteBannerProps) {
  return (
    <div
      data-testid="conflict-note-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 16px',
        background: 'var(--muted)',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        color: 'var(--accent-orange)',
        flexShrink: 0,
      }}
    >
      <AlertTriangle size={13} />
      <span>{translate(locale, 'editor.banner.conflict')}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto gap-1 rounded px-2 py-0.5 text-[11px] font-normal"
          data-testid="conflict-keep-mine-btn"
          onClick={onKeepMine}
          title={translate(locale, 'editor.banner.keepMineTooltip')}
        >
          {translate(locale, 'editor.banner.keepMine')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto gap-1 rounded px-2 py-0.5 text-[11px] font-normal"
          data-testid="conflict-keep-theirs-btn"
          onClick={onKeepTheirs}
          title={translate(locale, 'editor.banner.keepTheirsTooltip')}
        >
          {translate(locale, 'editor.banner.keepTheirs')}
        </Button>
      </div>
    </div>
  )
}
