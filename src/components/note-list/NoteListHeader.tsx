import { ArrowLineLeft, MagnifyingGlass, Plus, SidebarSimple } from '@phosphor-icons/react'
import { Loader2 } from 'lucide-react'
import type { VaultEntry } from '../../types'
import type { SortOption, SortDirection } from '../../utils/noteListHelpers'
import { translate, type AppLocale } from '../../lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../../hooks/appCommandDispatcher'
import { trackEvent } from '../../lib/telemetry'
import { useDragRegion } from '../../hooks/useDragRegion'
import { SortDropdown } from '../SortDropdown'
import { ListPropertiesPopover, type ListPropertiesPopoverProps } from './ListPropertiesPopover'
import { GitRepositorySelect } from '../GitRepositorySelect'
import type { GitRepositoryOption } from '../../utils/gitRepositories'

const NOTE_LIST_ACTION_BUTTON_CLASSNAME = '!h-auto !w-auto !min-w-0 !rounded-none !p-0 !text-muted-foreground hover:!bg-transparent hover:!text-foreground focus-visible:!bg-transparent data-[state=open]:!bg-transparent data-[state=open]:!text-foreground [&_svg]:!size-4'
const NOTE_LIST_EXPAND_BUTTON_CLASSNAME = '!h-6 !w-6 !min-w-0 !rounded !p-0 !text-muted-foreground hover:!bg-accent hover:!text-foreground focus-visible:!bg-accent [&_svg]:!size-4'

function localizePropertiesTriggerTitle(triggerTitle: string, locale: AppLocale): string {
  if (triggerTitle === 'Customize columns') return translate(locale, 'noteList.properties.customizeColumns')
  if (triggerTitle === 'Customize All Notes columns') return translate(locale, 'noteList.properties.customizeAllColumns')
  if (triggerTitle === 'Customize Inbox columns') return translate(locale, 'noteList.properties.customizeInboxColumns')

  const viewMatch = triggerTitle.match(/^Customize (.+) columns$/)
  return viewMatch
    ? translate(locale, 'noteList.properties.customizeViewColumns', { name: viewMatch[1] })
    : triggerTitle
}

interface NoteListHeaderProps {
  title: string
  typeDocument: VaultEntry | null
  isEntityView: boolean
  isChangesView?: boolean
  listSort: SortOption
  listDirection: SortDirection
  customProperties: string[]
  sidebarCollapsed?: boolean
  searchVisible: boolean
  search: string
  isSearching: boolean
  searchInputRef: React.RefObject<HTMLInputElement | null>
  propertyPicker?: ListPropertiesPopoverProps | null
  gitRepositories?: GitRepositoryOption[]
  selectedGitRepositoryPath?: string
  locale?: AppLocale
  onSortChange: (groupLabel: string, option: SortOption, direction: SortDirection) => void
  onCreateNote: () => void
  onOpenType: (entry: VaultEntry) => void
  onToggleSearch: () => void
  onSearchChange: (value: string) => void
  onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onGitRepositoryChange?: (path: string) => void
  onCollapse?: () => void
}

function dispatchExpandSidebarFromHeader() {
  trackEvent('sidebar_expanded_from_note_list_header')
  window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT_NAME, {
    detail: APP_COMMAND_IDS.viewAll,
  }))
}

function ExpandSidebarButton({ locale }: { locale: AppLocale }) {
  const expandSidebarLabel = translate(locale, 'sidebar.action.expand')

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={NOTE_LIST_EXPAND_BUTTON_CLASSNAME}
      onClick={dispatchExpandSidebarFromHeader}
      title={expandSidebarLabel}
      aria-label={expandSidebarLabel}
      data-no-drag
    >
      <SidebarSimple size={16} weight="regular" />
    </Button>
  )
}

function HeaderTitle({
  title,
  typeDocument,
  onOpenType,
}: Pick<NoteListHeaderProps, 'title' | 'typeDocument' | 'onOpenType'>) {
  const handleClick = typeDocument ? () => onOpenType(typeDocument) : undefined

  return (
    <h3
      className="m-0 min-w-0 flex-1 truncate text-[14px] font-semibold"
      style={typeDocument ? { cursor: 'pointer' } : undefined}
      onClick={handleClick}
      data-testid={typeDocument ? 'type-header-link' : undefined}
    >
      {title}
    </h3>
  )
}

function HeaderLeading({
  title,
  typeDocument,
  sidebarCollapsed,
  locale,
  onOpenType,
}: Pick<NoteListHeaderProps, 'title' | 'typeDocument' | 'sidebarCollapsed' | 'locale' | 'onOpenType'> & {
  locale: AppLocale
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {sidebarCollapsed && <ExpandSidebarButton locale={locale} />}
      <HeaderTitle title={title} typeDocument={typeDocument} onOpenType={onOpenType} />
    </div>
  )
}

function RepositorySelectorRow({
  isChangesView,
  gitRepositories = [],
  selectedGitRepositoryPath = '',
  locale = 'en',
  onGitRepositoryChange,
}: Pick<
  NoteListHeaderProps,
  | 'isChangesView'
  | 'gitRepositories'
  | 'selectedGitRepositoryPath'
  | 'locale'
  | 'onGitRepositoryChange'
>) {
  if (!isChangesView || !onGitRepositoryChange || gitRepositories.length <= 1) return null

  return (
    <div className="flex h-11 shrink-0 items-center border-b border-border px-4" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <GitRepositorySelect
        label={translate(locale, 'git.repository.select')}
        repositories={gitRepositories}
        selectedPath={selectedGitRepositoryPath}
        onChange={onGitRepositoryChange}
        testId="changes-repository-select"
      />
    </div>
  )
}

function HeaderActions({
  isEntityView,
  listSort,
  listDirection,
  customProperties,
  propertyPicker,
  locale,
  onSortChange,
  onCreateNote,
  onToggleSearch,
  onCollapse,
}: Pick<
  NoteListHeaderProps,
  | 'isEntityView'
  | 'listSort'
  | 'listDirection'
  | 'customProperties'
  | 'propertyPicker'
  | 'locale'
  | 'onSortChange'
  | 'onCreateNote'
  | 'onToggleSearch'
  | 'onCollapse'
> & {
  locale: AppLocale
}) {
  const collapseLabel = translate(locale, 'noteList.action.collapse')

  return (
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
      {onCollapse && (
        <Button type="button" variant="ghost" size="icon-xs" className={NOTE_LIST_ACTION_BUTTON_CLASSNAME} onClick={onCollapse} title={collapseLabel} aria-label={collapseLabel}>
          <ArrowLineLeft size={16} />
        </Button>
      )}
    </div>
  )
}

function SearchRow({
  searchVisible,
  search,
  isSearching,
  searchInputRef,
  locale,
  onSearchChange,
  onSearchKeyDown,
}: Pick<
  NoteListHeaderProps,
  | 'searchVisible'
  | 'search'
  | 'isSearching'
  | 'searchInputRef'
  | 'locale'
  | 'onSearchChange'
  | 'onSearchKeyDown'
> & {
  locale: AppLocale
}) {
  if (!searchVisible) return null

  return (
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
  )
}

export function NoteListHeader({
  title,
  typeDocument,
  isEntityView,
  isChangesView = false,
  listSort,
  listDirection,
  customProperties,
  sidebarCollapsed,
  searchVisible,
  search,
  isSearching,
  searchInputRef,
  propertyPicker,
  gitRepositories = [],
  selectedGitRepositoryPath = '',
  locale = 'en',
  onSortChange,
  onCreateNote,
  onOpenType,
  onToggleSearch,
  onSearchChange,
  onSearchKeyDown,
  onGitRepositoryChange,
  onCollapse,
}: NoteListHeaderProps) {
  const { onMouseDown: onDragMouseDown } = useDragRegion()

  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border px-4" onMouseDown={onDragMouseDown} style={{ cursor: 'default', paddingLeft: sidebarCollapsed ? 80 : undefined }}>
        <HeaderLeading
          title={title}
          typeDocument={typeDocument}
          sidebarCollapsed={sidebarCollapsed}
          locale={locale}
          onOpenType={onOpenType}
        />
        <HeaderActions
          isEntityView={isEntityView}
          listSort={listSort}
          listDirection={listDirection}
          customProperties={customProperties}
          propertyPicker={propertyPicker}
          locale={locale}
          onSortChange={onSortChange}
          onCreateNote={onCreateNote}
          onToggleSearch={onToggleSearch}
          onCollapse={onCollapse}
        />
      </div>
      <RepositorySelectorRow
        isChangesView={isChangesView}
        gitRepositories={gitRepositories}
        selectedGitRepositoryPath={selectedGitRepositoryPath}
        locale={locale}
        onGitRepositoryChange={onGitRepositoryChange}
      />
      <SearchRow
        searchVisible={searchVisible}
        search={search}
        isSearching={isSearching}
        searchInputRef={searchInputRef}
        locale={locale}
        onSearchChange={onSearchChange}
        onSearchKeyDown={onSearchKeyDown}
      />
    </>
  )
}
