import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getAppCommandMenuSections } from '../hooks/appCommandCatalog'
import { createTranslator, translate, type AppLocale } from '../lib/i18n'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

type MenuItem =
  | { kind: 'separator' }
  | {
      kind: 'command'
      commandId: string
      label: string
      menuItemId: string
      shortcut?: string
    }
  | { kind: 'action'; action: () => void; label: string; shortcut?: string }

type MenuSection = {
  items: ReadonlyArray<MenuItem>
  label: string
}

function menuSections(locale: AppLocale): ReadonlyArray<MenuSection> {
  const t = createTranslator(locale)
  return [
    ...getAppCommandMenuSections(t),
    {
      label: t('menu.window'),
      items: [
        { kind: 'action', label: t('window.minimize'), action: () => void getCurrentWindow().minimize().catch(() => {}) },
        { kind: 'action', label: t('window.maximize'), action: () => void getCurrentWindow().toggleMaximize().catch(() => {}) },
        { kind: 'separator' },
        { kind: 'action', label: t('window.close'), action: () => void getCurrentWindow().close().catch(() => {}) },
      ],
    },
  ]
}

const MENU_SECTIONS: ReadonlyArray<MenuSection> = menuSections('en')

function getMenuSections(locale: AppLocale): ReadonlyArray<MenuSection> {
  if (locale === 'en') return MENU_SECTIONS
  return menuSections(locale)
}

function triggerMenuCommand(menuItemId: string): void {
  void invoke('trigger_menu_command', { id: menuItemId }).catch(() => {})
}

function menuSeparatorKey(section: MenuSection, item: MenuItem): string {
  const ordinal = section.items
    .slice(0, section.items.indexOf(item) + 1)
    .filter(candidate => candidate.kind === 'separator')
    .length
  return `${section.label}-separator-${ordinal}`
}

function MenuSectionItems({ section }: { section: MenuSection }) {
  return (
    <>
      {section.items.map((item) => {
        if (item.kind === 'separator') {
          return <DropdownMenuSeparator key={menuSeparatorKey(section, item)} />
        }

        if (item.kind === 'command') {
          return (
            <DropdownMenuItem
              key={item.menuItemId}
              onSelect={() => triggerMenuCommand(item.menuItemId)}
            >
              <span>{item.label}</span>
              {item.shortcut && (
                <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
              )}
            </DropdownMenuItem>
          )
        }

        return (
          <DropdownMenuItem key={`${section.label}-${item.label}`} onSelect={item.action}>
            <span>{item.label}</span>
            {item.shortcut && <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

function HamburgerIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="2" y1="4" x2="12" y2="4" />
      <line x1="2" y1="7" x2="12" y2="7" />
      <line x1="2" y1="10" x2="12" y2="10" />
    </svg>
  )
}

function AppMenuButton({ locale, sections }: { locale: AppLocale; sections: ReadonlyArray<MenuSection> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={translate(locale, 'menu.application')}
          className="h-full w-[38px] rounded-none text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
          data-no-drag
        >
          <HamburgerIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0} className="min-w-[200px]">
        {sections.map((section) => (
          <DropdownMenuSub key={section.label}>
            <DropdownMenuSubTrigger>{section.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[220px]">
              <MenuSectionItems section={section} />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HorizontalMenuBar({ sections }: { sections: ReadonlyArray<MenuSection> }) {
  return (
    <div
      className="hidden h-full min-[760px]:flex"
      data-testid="desktop-horizontal-menu"
    >
      {sections.map((section) => (
        <DropdownMenu key={section.label} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-full rounded-none px-3 text-[13px] font-normal text-foreground/75 hover:bg-foreground/10 hover:text-foreground"
              data-no-drag
            >
              {section.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={0} className="min-w-[220px]">
            <MenuSectionItems section={section} />
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </div>
  )
}

export function LinuxMenuButton({ locale = 'en' }: { locale?: AppLocale } = {}) {
  const sections = getMenuSections(locale)

  return (
    <>
      <div className="min-[760px]:hidden">
        <AppMenuButton locale={locale} sections={sections} />
      </div>
      <HorizontalMenuBar sections={sections} />
    </>
  )
}
