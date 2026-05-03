import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { Loader2 } from 'lucide-react'
import type { VaultEntry } from '../../types'
import type { SortOption, SortDirection } from '../../utils/noteListHelpers'
import { translate, type AppLocale } from '../../lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDragRegion } from '../../hooks/useDragRegion'
import { SortDropdown } from '../SortDropdown'
import { ListPropertiesPopover, type ListPropertiesPopoverProps } from './ListPropertiesPopover'

const NOTE_LIST_ACTION_BUTTON_CLASSNAME = '!h-auto !w-auto !min-w-0 !rounded-none !p-0 !text-muted-foreground hover:!bg-transparent hover:!text-foreground focus-visible:!bg-transparent data-[state=open]:!bg-transparent data-[state=open]:!text-foreground [&_svg]:!size-4'

function localizePropertiesTriggerTitle(triggerTitle: string, locale: AppLocale): string {
  if (triggerTitle === 'Customize columns') return translate(locale, 'noteList.properties.customizeColumns')
  if (triggerTitle === 'Customize All Notes columns') return translate(locale, 'noteList.properties.customizeAllColumns')
  if (triggerTitle === 'Customize Inbox columns') return translate(locale, 'noteList.properties.customizeInboxColumns')

  const viewMatch = triggerTitle.match(/^Customize (.+) columns$/)
  return viewMatch
    ? translate(locale, 'noteList.properties.customizeViewColumns', { name: viewMatch[1] })
    : triggerTitle
}

export function NoteListHeader({ title, typeDocument, isEntityView, listSort, listDirection, customProperties, sidebarCollapsed, searchVisible, search, isSearching, searchInputRef, propertyPicker, locale = 'en', onSortChange, onCreateNote, onOpenType, onToggleSearch, onSearchChange, onSearchKeyDown }: {
  title: string
  typeDocument: VaultEntry | null
  isEntityView: boolean
  listSort: SortOption
  listDirection: SortDirection
  customProperties: string[]
  sidebarCollapsed?: boolean
  searchVisible: boolean
  search: string
  isSearching: boolean
  searchInputRef: React.RefObject<HTMLInputElement | null>
  propertyPicker?: ListPropertiesPopoverProps | null
  locale?: AppLocale
  onSortChange: (groupLabel: string, option: SortOption, direction: SortDirection) => void
  onCreateNote: () => void
  onOpenType: (entry: VaultEntry) => void
  onToggleSearch: () => void
  onSearchChange: (value: string) => void
  onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const { onMouseDown: onDragMouseDown } = useDragRegion()
  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border px-4" onMouseDown={onDragMouseDown} style={{ cursor: 'default', paddingLeft: sidebarCollapsed ? 80 : undefined }}>
        <h3
          className="m-0 min-w-0 flex-1 truncate text-[14px] font-semibold"
          style={typeDocument ? { cursor: 'pointer' } : undefined}
          onClick={typeDocument ? () => onOpenType(typeDocument) : undefined}
          data-testid={typeDocument ? 'type-header-link' : undefined}
        >
          {title}
        </h3>
        <div className="ml-3 flex shrink-0 items-center justify-end gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {!isEntityView && <SortDropdown groupLabel="__list__" current={listSort} direction={listDirection} customProperties={customProperties} locale={locale} onChange={onSortChange} />}
          <Button type="button" variant="ghost" size="icon-xs" className={NOTE_LIST_ACTION_BUTTON_CLASSNAME} onClick={onToggleSearch} title={translate(locale, 'noteList.searchAction')} aria-label={translate(locale, 'noteList.searchAction')}>
            <MagnifyingGlass size={16} />
          </Button>
          {propertyPicker && (
            <ListPropertiesPopover
              {...propertyPicker}
              triggerTitle={localizePropertiesTriggerTitle(propertyPicker.triggerTitle, locale)}
              triggerClassName={NOTE_LIST_ACTION_BUTTON_CLASSNAME}
              locale={locale}
            />
          )}
          <Button type="button" variant="ghost" size="icon-xs" className={NOTE_LIST_ACTION_BUTTON_CLASSNAME} onClick={onCreateNote} title={translate(locale, 'noteList.createNote')} aria-label={translate(locale, 'noteList.createNote')}>
            <Plus size={16} />
          </Button>
        </div>
      </div>
      {searchVisible && (
        <div className="border-b border-border px-3 py-2">
          <div className="relative flex-1" aria-live="polite">
            <Input
              ref={searchInputRef}
              placeholder={translate(locale, 'noteList.searchPlaceholder')}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={onSearchKeyDown}
              className="h-8 pr-8 text-[13px]"
            />
            {isSearching && (
              <span
                className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground"
                data-testid="note-list-search-loading"
              >
                <Loader2 size={12} className="animate-spin" />
              </span>
            )}
          </div>
        </div>
      )}
    </>
  )
}
