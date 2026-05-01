import { SlidersHorizontal, X, Sparkle, WarningCircle, PencilSimple } from '@phosphor-icons/react'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { Button } from '@/components/ui/button'
import { useDragRegion } from '../../hooks/useDragRegion'
import { translate, type AppLocale } from '../../lib/i18n'
import { hasFrontmatterWarnings, type FrontmatterWarnings } from '../../utils/frontmatter'

function FrontmatterWarningsButton({ locale, onOpenRawEditor }: { locale: AppLocale; onOpenRawEditor: () => void }) {
  const label = translate(locale, 'inspector.title.collidingProperties')
  return (
    <ActionTooltip copy={{ label }} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="h-6 w-6 shrink-0 rounded-md border border-[var(--feedback-warning-border)] bg-[var(--feedback-warning-bg)] p-0 text-[var(--feedback-warning-text)] shadow-none hover:brightness-95"
        aria-label={translate(locale, 'inspector.title.collidingPropertiesAria')}
        data-testid="frontmatter-warnings-button"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onOpenRawEditor}
      >
        <WarningCircle size={14} weight="fill" aria-hidden="true" />
      </Button>
    </ActionTooltip>
  )
}

export function InspectorHeader({ collapsed, frontmatterWarnings, locale = 'en', onToggle, onOpenRawEditor }: {
  collapsed: boolean
  frontmatterWarnings?: FrontmatterWarnings
  locale?: AppLocale
  onToggle: () => void
  onOpenRawEditor?: () => void
}) {
  const { onMouseDown } = useDragRegion()
  const propertiesTitle = translate(locale, 'inspector.title.properties')
  const showWarnings = Boolean(frontmatterWarnings && hasFrontmatterWarnings(frontmatterWarnings) && onOpenRawEditor)

  return (
    <div
      className="flex shrink-0 items-center border-b border-border"
      style={{ height: 52, padding: '6px 12px', gap: 8, cursor: 'default' }}
      onMouseDown={onMouseDown}
    >
      {collapsed ? (
        <button
          className="shrink-0 border-none bg-transparent p-1 text-muted-foreground cursor-pointer hover:text-foreground"
          onClick={onToggle}
          title={translate(locale, 'inspector.title.propertiesShortcut')}
        >
          <SlidersHorizontal size={16} />
        </button>
      ) : (
        <>
          <SlidersHorizontal size={16} className="shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground" style={{ fontSize: 13, fontWeight: 600 }}>{propertiesTitle}</span>
          {showWarnings && onOpenRawEditor && (
            <FrontmatterWarningsButton locale={locale} onOpenRawEditor={onOpenRawEditor} />
          )}
          <span className="flex-1" />
          <button
            className="shrink-0 border-none bg-transparent p-1 text-muted-foreground cursor-pointer hover:text-foreground"
            onClick={onToggle}
            title={translate(locale, 'inspector.title.closePropertiesShortcut')}
          >
            <X size={16} />
          </button>
        </>
      )}
    </div>
  )
}

export function EmptyInspector({ locale = 'en' }: { locale?: AppLocale }) {
  return <div><p className="m-0 text-[13px] text-muted-foreground">{translate(locale, 'inspector.empty.noNoteSelected')}</p></div>
}

export function InitializePropertiesPrompt({ locale = 'en', onClick }: { locale?: AppLocale; onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6">
      <Sparkle size={24} className="text-muted-foreground" />
      <p className="m-0 text-center text-[13px] text-muted-foreground">{translate(locale, 'inspector.empty.noProperties')}</p>
      <button
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        onClick={onClick}
      >
        {translate(locale, 'inspector.empty.initializeProperties')}
      </button>
    </div>
  )
}

export function InvalidFrontmatterNotice({ locale = 'en', onFix }: { locale?: AppLocale; onFix: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-destructive/40 bg-destructive/5 px-4 py-6">
      <WarningCircle size={24} className="text-destructive" />
      <p className="m-0 text-center text-[13px] text-muted-foreground">{translate(locale, 'inspector.empty.invalidProperties')}</p>
      <button
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        onClick={onFix}
      >
        <PencilSimple size={14} />
        {translate(locale, 'inspector.empty.fixInEditor')}
      </button>
    </div>
  )
}
