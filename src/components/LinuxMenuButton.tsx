import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { APP_COMMAND_MENU_SECTIONS } from '../hooks/appCommandCatalog'
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

const MENU_SECTIONS: ReadonlyArray<MenuSection> = [
  ...APP_COMMAND_MENU_SECTIONS,
  {
    label: 'Window',
    items: [
      { kind: 'action', label: 'Minimize', action: () => void getCurrentWindow().minimize().catch(() => {}) },
      { kind: 'action', label: 'Maximize', action: () => void getCurrentWindow().toggleMaximize().catch(() => {}) },
      { kind: 'separator' },
      { kind: 'action', label: 'Close', action: () => void getCurrentWindow().close().catch(() => {}) },
    ],
  },
]

function triggerMenuCommand(menuItemId: string): void {
  void invoke('trigger_menu_command', { id: menuItemId }).catch(() => {})
}

function HamburgerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="2" y1="4" x2="12" y2="4" />
      <line x1="2" y1="7" x2="12" y2="7" />
      <line x1="2" y1="10" x2="12" y2="10" />
    </svg>
  )
}

export function LinuxMenuButton() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Application menu"
          className="h-full w-[38px] rounded-none text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
          data-no-drag
        >
          <HamburgerIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0} className="min-w-[200px]">
        {MENU_SECTIONS.map((section) => (
          <DropdownMenuSub key={section.label}>
            <DropdownMenuSubTrigger>{section.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[220px]">
              {section.items.map((item, index) => {
                if (item.kind === 'separator') {
                  return <DropdownMenuSeparator key={`${section.label}-${index}`} />
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
