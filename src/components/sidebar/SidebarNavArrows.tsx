import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { ActionTooltip } from '@/components/ui/action-tooltip'
import { APP_COMMAND_IDS, getAppCommandShortcutDisplay } from '../../hooks/appCommandCatalog'
import { translate, type AppLocale } from '../../lib/i18n'
import { trackNavigationHistoryButtonClicked } from '../../lib/productAnalytics'

export interface SidebarNavArrowsProps {
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
  locale?: AppLocale
}

const navButtonClass = 'h-6 w-6 rounded text-muted-foreground hover:text-foreground disabled:opacity-40'

export function SidebarNavArrows({
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  locale = 'en',
}: SidebarNavArrowsProps) {
  const backLabel = translate(locale, 'sidebar.nav.back')
  const forwardLabel = translate(locale, 'sidebar.nav.forward')
  const backShortcut = getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewGoBack)
  const forwardShortcut = getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewGoForward)

  const handleBackClick = () => {
    trackNavigationHistoryButtonClicked('back')
    onGoBack()
  }
  const handleForwardClick = () => {
    trackNavigationHistoryButtonClicked('forward')
    onGoForward()
  }

  return (
    <div className="flex items-center gap-1" data-testid="sidebar-nav-arrows">
      <ActionTooltip copy={{ label: backLabel, shortcut: backShortcut }} side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={navButtonClass}
          disabled={!canGoBack}
          onClick={handleBackClick}
          aria-label={backLabel}
          data-no-drag
          data-testid="sidebar-nav-back"
        >
          <CaretLeft size={14} weight="bold" />
        </Button>
      </ActionTooltip>
      <ActionTooltip copy={{ label: forwardLabel, shortcut: forwardShortcut }} side="bottom">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={navButtonClass}
          disabled={!canGoForward}
          onClick={handleForwardClick}
          aria-label={forwardLabel}
          data-no-drag
          data-testid="sidebar-nav-forward"
        >
          <CaretRight size={14} weight="bold" />
        </Button>
      </ActionTooltip>
    </div>
  )
}
