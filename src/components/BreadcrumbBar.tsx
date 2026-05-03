import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import type { NoteWidthMode, VaultEntry } from '../types'
import { cn } from '@/lib/utils'
import { translate, type AppLocale } from '../lib/i18n'
import { formatShortcutDisplay } from '../hooks/appCommandCatalog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ActionTooltip, type ActionTooltipCopy } from '@/components/ui/action-tooltip'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  GitBranch,
  Code,
  Sparkle,
  SidebarSimple,
  Trash,
  Archive,
  ArrowUUpLeft,
  ClipboardText,
  FolderOpen,
  Star,
  CheckCircle,
  ArrowsClockwise,
  ArrowsInLineHorizontal,
  ArrowsOutLineHorizontal,
  DotsThree,
} from '@phosphor-icons/react'
import { slugify } from '../hooks/useNoteCreation'
import { useDragRegion } from '../hooks/useDragRegion'

interface BreadcrumbBarProps {
  entry: VaultEntry
  wordCount: number
  showDiffToggle: boolean
  diffMode: boolean
  diffLoading: boolean
  onToggleDiff: () => void
  rawMode?: boolean
  onToggleRaw?: () => void
  /** When true, raw mode is forced (non-markdown file) — hide the toggle. */
  forceRawMode?: boolean
  showAIChat?: boolean
  onToggleAIChat?: () => void
  inspectorCollapsed?: boolean
  onToggleInspector?: () => void
  onToggleFavorite?: () => void
  onToggleOrganized?: () => void
  onRevealFile?: (path: string) => void
  onCopyFilePath?: (path: string) => void
  onDelete?: () => void
  onArchive?: () => void
  onUnarchive?: () => void
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  noteWidth?: NoteWidthMode
  onToggleNoteWidth?: () => void
  /** Ref for direct DOM manipulation — avoids re-render on scroll. */
  barRef?: React.Ref<HTMLDivElement>
  locale?: AppLocale
  loadingTitle?: boolean
}

const DISABLED_ICON_STYLE = { opacity: 0.4, cursor: 'not-allowed' } as const
const BREADCRUMB_ICON_CLASS = 'size-[16px]'
const TITLE_ACTION_GAP_PX = 24

function focusFilenameInput(
  isEditing: boolean,
  inputRef: React.RefObject<HTMLInputElement | null>,
) {
  if (!isEditing) return
  inputRef.current?.focus()
  inputRef.current?.select()
}

function beginFilenameEditing(
  onRenameFilename: BreadcrumbBarProps['onRenameFilename'],
  filenameStem: string,
  setDraftStem: (value: string) => void,
  setIsEditing: (value: boolean) => void,
) {
  if (!onRenameFilename) return
  setDraftStem(filenameStem)
  setIsEditing(true)
}

function resolveFilenameRenameTarget(draftStem: string, filenameStem: string): string | null {
  const nextStem = normalizeFilenameStemInput(draftStem)
  if (!nextStem || nextStem === filenameStem) return null
  return nextStem
}

function handleFilenameInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  submitRename: () => void,
  cancelEditing: () => void,
) {
  switch (event.key) {
    case 'Enter':
      event.preventDefault()
      submitRename()
      return
    case 'Escape':
      event.preventDefault()
      cancelEditing()
      return
    default:
      return
  }
}

function IconActionButton({
  copy,
  onClick,
  className,
  style,
  children,
  testId,
  tooltipAlign = 'end',
}: {
  copy: ActionTooltipCopy
  onClick?: () => void
  className?: string
  style?: CSSProperties
  children: ReactNode
  testId?: string
  tooltipAlign?: 'start' | 'center' | 'end'
}) {
  return (
    <ActionTooltip copy={copy} side="bottom" align={tooltipAlign}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn('text-muted-foreground [&_svg:not([class*=size-])]:size-4', className)}
        style={style}
        onClick={onClick}
        aria-label={copy.label}
        aria-disabled={onClick ? undefined : true}
        data-testid={testId}
      >
        {children}
      </Button>
    </ActionTooltip>
  )
}

interface ToggleIconActionProps {
  active: boolean
  activeClassName: string
  activeLabel: string
  children: ReactNode
  inactiveClassName?: string
  inactiveLabel: string
  onClick?: () => void
  shortcut: string
}

interface TranslatedToggleIconActionProps extends Omit<ToggleIconActionProps, 'activeLabel' | 'inactiveLabel'> {
  activeLabelKey: Parameters<typeof translate>[1]
  inactiveLabelKey: Parameters<typeof translate>[1]
  locale?: AppLocale
}

function ToggleIconAction({
  active,
  activeClassName,
  activeLabel,
  children,
  inactiveClassName = 'hover:text-foreground',
  inactiveLabel,
  onClick,
  shortcut,
}: ToggleIconActionProps) {
  return (
    <IconActionButton
      copy={{
        label: active ? activeLabel : inactiveLabel,
        shortcut,
      }}
      onClick={onClick}
      className={cn(active ? activeClassName : inactiveClassName)}
    >
      {children}
    </IconActionButton>
  )
}

function TranslatedToggleIconAction({
  activeLabelKey,
  inactiveLabelKey,
  locale = 'en',
  ...props
}: TranslatedToggleIconActionProps) {
  return (
    <ToggleIconAction
      {...props}
      activeLabel={translate(locale, activeLabelKey)}
      inactiveLabel={translate(locale, inactiveLabelKey)}
    />
  )
}

const TOGGLE_ACTION_CONFIGS = {
  raw: {
    activeClassName: 'text-foreground',
    activeLabelKey: 'editor.toolbar.rawReturn',
    inactiveLabelKey: 'editor.toolbar.rawOpen',
    shortcut: '⌘\\',
    renderIcon: () => <Code size={16} className={BREADCRUMB_ICON_CLASS} />,
  },
  favorite: {
    activeClassName: 'text-[var(--accent-yellow)]',
    activeLabelKey: 'editor.toolbar.removeFavorite',
    inactiveLabelKey: 'editor.toolbar.addFavorite',
    shortcut: '⌘D',
    renderIcon: (active: boolean) => <Star size={16} weight={active ? 'fill' : 'regular'} className={BREADCRUMB_ICON_CLASS} />,
  },
  organized: {
    activeClassName: 'text-[var(--accent-green)]',
    activeLabelKey: 'editor.toolbar.markUnorganized',
    inactiveLabelKey: 'editor.toolbar.markOrganized',
    shortcut: '⌘E',
    renderIcon: (active: boolean) => <CheckCircle size={16} weight={active ? 'fill' : 'regular'} className={BREADCRUMB_ICON_CLASS} />,
  },
} satisfies Record<string, {
  activeClassName: string
  activeLabelKey: Parameters<typeof translate>[1]
  inactiveLabelKey: Parameters<typeof translate>[1]
  shortcut: string
  renderIcon: (active: boolean) => ReactNode
}>

function ConfiguredToggleAction({
  active,
  config,
  locale = 'en',
  onClick,
}: {
  active: boolean
  config: (typeof TOGGLE_ACTION_CONFIGS)[keyof typeof TOGGLE_ACTION_CONFIGS]
  locale?: AppLocale
  onClick?: () => void
}) {
  return (
    <TranslatedToggleIconAction
      active={active}
      activeClassName={config.activeClassName}
      activeLabelKey={config.activeLabelKey}
      inactiveLabelKey={config.inactiveLabelKey}
      locale={locale}
      onClick={onClick}
      shortcut={formatShortcutDisplay({ display: config.shortcut })}
    >
      {config.renderIcon(active)}
    </TranslatedToggleIconAction>
  )
}

function RawToggleButton({ rawMode, locale = 'en', onToggleRaw }: { rawMode?: boolean; locale?: AppLocale; onToggleRaw?: () => void }) {
  return <ConfiguredToggleAction active={!!rawMode} config={TOGGLE_ACTION_CONFIGS.raw} locale={locale} onClick={onToggleRaw} />
}

function NoteWidthAction({
  noteWidth = 'normal',
  locale = 'en',
  onToggleNoteWidth,
}: {
  noteWidth?: NoteWidthMode
  locale?: AppLocale
  onToggleNoteWidth?: () => void
}) {
  if (!onToggleNoteWidth) return null

  const isWide = noteWidth === 'wide'
  return (
    <IconActionButton
      copy={{ label: translate(locale, isWide ? 'editor.toolbar.noteWidthNormal' : 'editor.toolbar.noteWidthWide') }}
      onClick={onToggleNoteWidth}
      className={cn(isWide ? 'text-foreground' : 'hover:text-foreground')}
    >
      {isWide
        ? <ArrowsInLineHorizontal size={16} className={BREADCRUMB_ICON_CLASS} />
        : <ArrowsOutLineHorizontal size={16} className={BREADCRUMB_ICON_CLASS} />}
    </IconActionButton>
  )
}

function FavoriteAction({ favorite, locale = 'en', onToggleFavorite }: { favorite: boolean; locale?: AppLocale; onToggleFavorite?: () => void }) {
  return <ConfiguredToggleAction active={favorite} config={TOGGLE_ACTION_CONFIGS.favorite} locale={locale} onClick={onToggleFavorite} />
}

function OrganizedAction({
  organized,
  locale = 'en',
  onToggleOrganized,
}: {
  organized: boolean
  locale?: AppLocale
  onToggleOrganized?: () => void
}) {
  if (!onToggleOrganized) return null
  return <ConfiguredToggleAction active={organized} config={TOGGLE_ACTION_CONFIGS.organized} locale={locale} onClick={onToggleOrganized} />
}

function DiffAction({
  showDiffToggle,
  diffMode,
  diffLoading,
  locale = 'en',
  onToggleDiff,
}: Pick<BreadcrumbBarProps, 'showDiffToggle' | 'diffMode' | 'diffLoading' | 'locale' | 'onToggleDiff'>) {
  if (!showDiffToggle) {
    return (
      <IconActionButton copy={{ label: translate(locale, 'editor.toolbar.noDiff') }} style={DISABLED_ICON_STYLE}>
        <GitBranch size={16} className={BREADCRUMB_ICON_CLASS} />
      </IconActionButton>
    )
  }

  const copy: ActionTooltipCopy = diffLoading
    ? { label: translate(locale, 'editor.toolbar.loadingDiff') }
    : { label: translate(locale, diffMode ? 'editor.toolbar.rawReturn' : 'editor.toolbar.showDiff') }
  return (
    <IconActionButton
      copy={copy}
      onClick={onToggleDiff}
      className={cn(diffMode ? 'text-foreground' : 'hover:text-foreground')}
    >
      <GitBranch size={16} className={BREADCRUMB_ICON_CLASS} />
    </IconActionButton>
  )
}

function AIChatAction({ showAIChat, locale = 'en', onToggleAIChat }: Pick<BreadcrumbBarProps, 'showAIChat' | 'locale' | 'onToggleAIChat'>) {
  return (
    <ToggleIconAction
      active={!!showAIChat}
      activeClassName="text-primary"
      activeLabel={translate(locale, 'editor.toolbar.closeAi')}
      inactiveLabel={translate(locale, 'editor.toolbar.openAi')}
      onClick={onToggleAIChat}
      shortcut={formatShortcutDisplay({ display: '⌘⇧L' })}
    >
      <Sparkle size={16} weight={showAIChat ? 'fill' : 'regular'} className={BREADCRUMB_ICON_CLASS} />
    </ToggleIconAction>
  )
}

function ArchiveAction({
  archived,
  locale = 'en',
  onArchive,
  onUnarchive,
}: Pick<VaultEntry, 'archived'> & Pick<BreadcrumbBarProps, 'locale' | 'onArchive' | 'onUnarchive'>) {
  if (archived) {
    return (
      <IconActionButton copy={{ label: translate(locale, 'editor.toolbar.restoreArchived') }} onClick={onUnarchive} className="hover:text-foreground">
        <ArrowUUpLeft size={16} className={BREADCRUMB_ICON_CLASS} />
      </IconActionButton>
    )
  }

  return (
    <IconActionButton copy={{ label: translate(locale, 'editor.toolbar.archive') }} onClick={onArchive} className="hover:text-foreground">
      <Archive size={16} className={BREADCRUMB_ICON_CLASS} />
    </IconActionButton>
  )
}

function DeleteAction({ locale = 'en', onDelete }: Pick<BreadcrumbBarProps, 'locale' | 'onDelete'>) {
  return (
    <IconActionButton
      copy={{
        label: translate(locale, 'editor.toolbar.delete'),
        shortcut: formatShortcutDisplay({ display: '⌘⌫ / ⌘⌦' }),
      }}
      onClick={onDelete}
      className="hover:text-destructive"
    >
      <Trash size={16} className={BREADCRUMB_ICON_CLASS} />
    </IconActionButton>
  )
}

function FilePathActions({
  entry,
  locale = 'en',
  onRevealFile,
  onCopyFilePath,
}: Pick<BreadcrumbBarProps, 'entry' | 'locale' | 'onRevealFile' | 'onCopyFilePath'>) {
  return (
    <>
      {onRevealFile && (
        <IconActionButton
          copy={{ label: translate(locale, 'editor.toolbar.revealFile') }}
          onClick={() => onRevealFile(entry.path)}
          className="hover:text-foreground"
          testId="breadcrumb-reveal-file"
        >
          <FolderOpen size={16} className={BREADCRUMB_ICON_CLASS} />
        </IconActionButton>
      )}
      {onCopyFilePath && (
        <IconActionButton
          copy={{ label: translate(locale, 'editor.toolbar.copyFilePath') }}
          onClick={() => onCopyFilePath(entry.path)}
          className="hover:text-foreground"
          testId="breadcrumb-copy-file-path"
        >
          <ClipboardText size={16} className={BREADCRUMB_ICON_CLASS} />
        </IconActionButton>
      )}
    </>
  )
}

function InspectorAction({
  inspectorCollapsed,
  locale = 'en',
  onToggleInspector,
}: Pick<BreadcrumbBarProps, 'inspectorCollapsed' | 'locale' | 'onToggleInspector'>) {
  if (!inspectorCollapsed) return null
  return (
    <IconActionButton
      copy={{
        label: translate(locale, 'editor.toolbar.openProperties'),
        shortcut: formatShortcutDisplay({ display: '⌘⇧I' }),
      }}
      onClick={onToggleInspector}
      className="hover:text-foreground"
      tooltipAlign="end"
    >
      <SidebarSimple size={16} weight="regular" className={BREADCRUMB_ICON_CLASS} style={{ transform: 'scaleX(-1)' }} />
    </IconActionButton>
  )
}

function OverflowToolbarAction({ children }: { children: ReactNode }) {
  return <span className="breadcrumb-bar__overflowable-action flex items-center gap-2">{children}</span>
}

function diffMenuLabelKey({
  showDiffToggle,
  diffMode,
  diffLoading,
}: Pick<BreadcrumbBarProps, 'showDiffToggle' | 'diffMode' | 'diffLoading'>): Parameters<typeof translate>[1] {
  if (diffLoading) return 'editor.toolbar.loadingDiff'
  if (diffMode) return 'editor.toolbar.rawReturn'
  if (showDiffToggle) return 'editor.toolbar.showDiff'
  return 'editor.toolbar.noDiff'
}

function availableDiffAction(showDiffToggle: boolean, onToggleDiff: () => void): (() => void) | undefined {
  return showDiffToggle ? onToggleDiff : undefined
}

function noteWidthLabelKey(noteWidth: NoteWidthMode = 'normal'): Parameters<typeof translate>[1] {
  return noteWidth === 'wide' ? 'editor.toolbar.noteWidthNormal' : 'editor.toolbar.noteWidthWide'
}

function NoteWidthMenuIcon({ noteWidth = 'normal' }: { noteWidth?: NoteWidthMode }) {
  return noteWidth === 'wide' ? <ArrowsInLineHorizontal size={16} /> : <ArrowsOutLineHorizontal size={16} />
}

function archiveLabelKey(archived: boolean): Parameters<typeof translate>[1] {
  return archived ? 'editor.toolbar.restoreArchived' : 'editor.toolbar.archive'
}

function archiveAction(
  archived: boolean,
  onArchive?: () => void,
  onUnarchive?: () => void,
): (() => void) | undefined {
  return archived ? onUnarchive : onArchive
}

function pathAction(action: ((path: string) => void) | undefined, path: string): (() => void) | undefined {
  return action ? () => action(path) : undefined
}

function ArchiveMenuIcon({ archived }: { archived: boolean }) {
  return archived ? <ArrowUUpLeft size={16} /> : <Archive size={16} />
}

function measureExpandedActionsWidth(
  actions: HTMLDivElement,
  collapsed: boolean,
  cachedExpandedActionsWidth: number,
) {
  return collapsed ? cachedExpandedActionsWidth || actions.scrollWidth : actions.scrollWidth
}

function readElementWidth(element: HTMLElement): number {
  return element.getBoundingClientRect().width || element.scrollWidth || element.clientWidth
}

function prepareTitleMeasurementClone(clone: HTMLElement) {
  clone.setAttribute('aria-hidden', 'true')
  clone.style.position = 'absolute'
  clone.style.visibility = 'hidden'
  clone.style.pointerEvents = 'none'
  clone.style.width = 'max-content'
  clone.style.minWidth = 'max-content'
  clone.style.maxWidth = 'none'
  clone.style.overflow = 'visible'
  clone.style.whiteSpace = 'nowrap'
}

function removeCloneTruncation(clone: HTMLElement) {
  for (const node of clone.querySelectorAll<HTMLElement>('.truncate')) {
    node.style.overflow = 'visible'
    node.style.textOverflow = 'clip'
    node.style.whiteSpace = 'nowrap'
    node.style.width = 'max-content'
    node.style.minWidth = 'max-content'
    node.style.maxWidth = 'none'
  }
}

function measureNaturalTitleWidth(title: HTMLDivElement): number {
  const titleContent = title.querySelector('.breadcrumb-bar__title-content')
  if (!(titleContent instanceof HTMLElement)) return readElementWidth(title)

  const clone = titleContent.cloneNode(true) as HTMLElement
  prepareTitleMeasurementClone(clone)
  removeCloneTruncation(clone)
  title.appendChild(clone)
  const width = readElementWidth(clone)
  clone.remove()
  return width
}

function expandedActionsLeft(actions: HTMLDivElement, expandedActionsWidth: number): number {
  const actionsRight = actions.getBoundingClientRect().right
  return actionsRight - expandedActionsWidth
}

function shouldCollapseBreadcrumbOverflow(
  title: HTMLDivElement,
  actions: HTMLDivElement,
  expandedActionsWidth: number,
) {
  const titleLeft = title.getBoundingClientRect().left
  const availableTitleWidth = expandedActionsLeft(actions, expandedActionsWidth) - titleLeft - TITLE_ACTION_GAP_PX
  return measureNaturalTitleWidth(title) > availableTitleWidth
}

function useBreadcrumbOverflow(
  titleRef: React.RefObject<HTMLDivElement | null>,
  actionsRef: React.RefObject<HTMLDivElement | null>,
) {
  const [collapsed, setCollapsed] = useState(false)
  const expandedActionsWidthRef = useRef(0)

  useLayoutEffect(() => {
    const title = titleRef.current
    const actions = actionsRef.current
    const bar = title?.closest('.breadcrumb-bar') as HTMLDivElement | null
    if (!title || !actions || !bar) return undefined

    let frame = 0
    const measure = () => {
      const expandedActionsWidth = measureExpandedActionsWidth(actions, collapsed, expandedActionsWidthRef.current)
      if (!collapsed) expandedActionsWidthRef.current = expandedActionsWidth
      setCollapsed(shouldCollapseBreadcrumbOverflow(title, actions, expandedActionsWidth))
    }
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }

    scheduleMeasure()
    if (typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(frame)
    }

    const resizeObserver = new ResizeObserver(scheduleMeasure)
    resizeObserver.observe(bar)
    resizeObserver.observe(title)
    resizeObserver.observe(actions)

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  })

  return collapsed
}

function normalizeFilenameStemInput(value: string): string {
  const trimmed = value.trim()
  return trimmed.replace(/\.md$/i, '').trim()
}

function deriveSyncStem(entry: VaultEntry): string | null {
  const expectedStem = slugify(entry.title.trim())
  const filenameStem = entry.filename.replace(/\.md$/, '')
  if (!expectedStem || expectedStem === filenameStem) return null
  return expectedStem
}

function FilenameInput({
  inputRef,
  draftStem,
  locale = 'en',
  onDraftStemChange,
  onBlur,
  onKeyDown,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  draftStem: string
  locale?: AppLocale
  onDraftStemChange: (nextValue: string) => void
  onBlur: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <Input
      ref={inputRef}
      value={draftStem}
      onChange={(event) => onDraftStemChange(event.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className="h-7 w-[180px] text-sm"
      data-testid="breadcrumb-filename-input"
      aria-label={translate(locale, 'editor.filename.rename')}
    />
  )
}

function FilenameTrigger({
  filenameStem,
  locale = 'en',
  onStartEditing,
}: {
  filenameStem: string
  locale?: AppLocale
  onStartEditing: () => void
}) {
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    onStartEditing()
  }, [onStartEditing])

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="h-auto min-w-0 gap-1 px-0 py-0 text-sm font-medium text-foreground hover:bg-transparent hover:text-foreground"
      onDoubleClick={onStartEditing}
      onKeyDown={handleKeyDown}
      data-testid="breadcrumb-filename-trigger"
      aria-label={translate(locale, 'editor.filename.trigger', { filename: filenameStem })}
    >
      <span className="breadcrumb-bar__filename-text truncate">{filenameStem}</span>
    </Button>
  )
}

function SyncFilenameButton({
  entryPath,
  syncStem,
  locale = 'en',
  onRenameFilename,
}: {
  entryPath: string
  syncStem: string | null
  locale?: AppLocale
  onRenameFilename?: (path: string, newFilenameStem: string) => void
}) {
  if (!syncStem || !onRenameFilename) return null
  return (
    <ActionTooltip copy={{ label: translate(locale, 'editor.filename.renameToTitle') }} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => onRenameFilename(entryPath, syncStem)}
        data-testid="breadcrumb-sync-button"
        aria-label={translate(locale, 'editor.filename.renameToTitle')}
      >
        <ArrowsClockwise size={14} />
      </Button>
    </ActionTooltip>
  )
}

function FilenameDisplay({
  entry,
  filenameStem,
  syncStem,
  locale,
  onRenameFilename,
  onStartEditing,
}: {
  entry: VaultEntry
  filenameStem: string
  syncStem: string | null
  locale?: AppLocale
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  onStartEditing: () => void
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <FilenameTrigger filenameStem={filenameStem} locale={locale} onStartEditing={onStartEditing} />
      <SyncFilenameButton entryPath={entry.path} syncStem={syncStem} locale={locale} onRenameFilename={onRenameFilename} />
    </div>
  )
}

function FilenameCrumb({ entry, locale = 'en', onRenameFilename }: Pick<BreadcrumbBarProps, 'entry' | 'locale' | 'onRenameFilename'>) {
  const filenameStem = useMemo(() => entry.filename.replace(/\.md$/, ''), [entry.filename])
  const syncStem = useMemo(() => deriveSyncStem(entry), [entry])
  const [isEditing, setIsEditing] = useState(false)
  const [draftStem, setDraftStem] = useState(filenameStem)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    focusFilenameInput(isEditing, inputRef)
  }, [isEditing])

  const startEditing = useCallback(() => {
    beginFilenameEditing(onRenameFilename, filenameStem, setDraftStem, setIsEditing)
  }, [onRenameFilename, filenameStem])

  const cancelEditing = useCallback(() => {
    setDraftStem(filenameStem)
    setIsEditing(false)
  }, [filenameStem])

  const submitRename = useCallback(() => {
    setIsEditing(false)
    const nextStem = resolveFilenameRenameTarget(draftStem, filenameStem)
    if (!nextStem) return
    onRenameFilename?.(entry.path, nextStem)
  }, [draftStem, filenameStem, onRenameFilename, entry.path])

  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    handleFilenameInputKeyDown(event, submitRename, cancelEditing)
  }, [submitRename, cancelEditing])

  if (isEditing) {
    return (
      <FilenameInput
        inputRef={inputRef}
        draftStem={draftStem}
        locale={locale}
        onDraftStemChange={setDraftStem}
        onBlur={submitRename}
        onKeyDown={handleInputKeyDown}
      />
    )
  }

  return (
    <FilenameDisplay
      entry={entry}
      filenameStem={filenameStem}
      syncStem={syncStem}
      locale={locale}
      onRenameFilename={onRenameFilename}
      onStartEditing={startEditing}
    />
  )
}

function BreadcrumbTitleSkeleton() {
  return (
    <span
      aria-hidden="true"
      data-testid="breadcrumb-title-skeleton"
      className="h-4 w-36 animate-pulse rounded bg-muted"
    />
  )
}

function BreadcrumbActions({
  entry,
  showDiffToggle,
  diffMode,
  diffLoading,
  onToggleDiff,
  rawMode,
  onToggleRaw,
  forceRawMode,
  noteWidth,
  onToggleNoteWidth,
  showAIChat,
  onToggleAIChat,
  inspectorCollapsed,
  onToggleInspector,
  onToggleFavorite,
  onToggleOrganized,
  onRevealFile,
  onCopyFilePath,
  onDelete,
  onArchive,
  onUnarchive,
  actionsRef,
  overflowCollapsed,
  locale = 'en',
}: Omit<BreadcrumbBarProps, 'wordCount' | 'barRef' | 'onRenameFilename'> & {
  actionsRef: React.RefObject<HTMLDivElement | null>
  overflowCollapsed: boolean
}) {
  return (
    <div
      ref={actionsRef}
      className="breadcrumb-bar__actions ml-auto flex shrink-0 items-center"
      data-overflow-collapsed={overflowCollapsed}
      style={{ gap: 8 }}
    >
      <FavoriteAction favorite={entry.favorite} locale={locale} onToggleFavorite={onToggleFavorite} />
      <OrganizedAction organized={entry.organized} locale={locale} onToggleOrganized={onToggleOrganized} />
      <OverflowToolbarAction>
        <DiffAction
          showDiffToggle={showDiffToggle}
          diffMode={diffMode}
          diffLoading={diffLoading}
          onToggleDiff={onToggleDiff}
          locale={locale}
        />
      </OverflowToolbarAction>
      {!forceRawMode && <RawToggleButton rawMode={rawMode} locale={locale} onToggleRaw={onToggleRaw} />}
      <OverflowToolbarAction>
        <NoteWidthAction noteWidth={noteWidth} locale={locale} onToggleNoteWidth={onToggleNoteWidth} />
      </OverflowToolbarAction>
      <AIChatAction showAIChat={showAIChat} locale={locale} onToggleAIChat={onToggleAIChat} />
      <OverflowToolbarAction>
        <FilePathActions entry={entry} locale={locale} onRevealFile={onRevealFile} onCopyFilePath={onCopyFilePath} />
      </OverflowToolbarAction>
      <OverflowToolbarAction>
        <ArchiveAction archived={entry.archived} locale={locale} onArchive={onArchive} onUnarchive={onUnarchive} />
      </OverflowToolbarAction>
      <OverflowToolbarAction>
        <DeleteAction locale={locale} onDelete={onDelete} />
      </OverflowToolbarAction>
      <BreadcrumbOverflowMenu
        entry={entry}
        showDiffToggle={showDiffToggle}
        diffMode={diffMode}
        diffLoading={diffLoading}
        onToggleDiff={onToggleDiff}
        noteWidth={noteWidth}
        onToggleNoteWidth={onToggleNoteWidth}
        onRevealFile={onRevealFile}
        onCopyFilePath={onCopyFilePath}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDelete={onDelete}
        locale={locale}
      />
      <InspectorAction inspectorCollapsed={inspectorCollapsed} locale={locale} onToggleInspector={onToggleInspector} />
    </div>
  )
}

function BreadcrumbOverflowMenu({
  entry,
  showDiffToggle,
  diffMode,
  diffLoading,
  onToggleDiff,
  noteWidth,
  onToggleNoteWidth,
  onRevealFile,
  onCopyFilePath,
  onArchive,
  onUnarchive,
  onDelete,
  locale = 'en',
}: Pick<
  BreadcrumbBarProps,
  | 'entry'
  | 'showDiffToggle'
  | 'diffMode'
  | 'diffLoading'
  | 'onToggleDiff'
  | 'noteWidth'
  | 'onToggleNoteWidth'
  | 'onRevealFile'
  | 'onCopyFilePath'
  | 'onArchive'
  | 'onUnarchive'
  | 'onDelete'
  | 'locale'
>) {
  const runDiffAction = availableDiffAction(showDiffToggle, onToggleDiff)
  const runRevealAction = pathAction(onRevealFile, entry.path)
  const runCopyPathAction = pathAction(onCopyFilePath, entry.path)
  const runArchiveAction = archiveAction(entry.archived, onArchive, onUnarchive)
  const diffLabel = translate(locale, diffMenuLabelKey({ showDiffToggle, diffMode, diffLoading }))
  const noteWidthLabel = translate(locale, noteWidthLabelKey(noteWidth))
  const archiveLabel = translate(locale, archiveLabelKey(entry.archived))

  return (
    <DropdownMenu>
      <ActionTooltip copy={{ label: translate(locale, 'editor.toolbar.moreActions') }} side="bottom" align="end">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="breadcrumb-bar__overflow-menu text-muted-foreground hover:text-foreground"
            aria-label={translate(locale, 'editor.toolbar.moreActions')}
            data-testid="breadcrumb-overflow-menu-trigger"
          >
            <DotsThree size={18} weight="bold" className={BREADCRUMB_ICON_CLASS} />
          </Button>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem disabled={!runDiffAction} onSelect={runDiffAction}>
          <GitBranch size={16} />
          {diffLabel}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!onToggleNoteWidth} onSelect={onToggleNoteWidth}>
          <NoteWidthMenuIcon noteWidth={noteWidth} />
          {noteWidthLabel}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!runRevealAction} onSelect={runRevealAction}>
          <FolderOpen size={16} />
          {translate(locale, 'editor.toolbar.revealFile')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!runCopyPathAction} onSelect={runCopyPathAction}>
          <ClipboardText size={16} />
          {translate(locale, 'editor.toolbar.copyFilePath')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!runArchiveAction} onSelect={runArchiveAction}>
          <ArchiveMenuIcon archived={entry.archived} />
          {archiveLabel}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!onDelete} variant="destructive" onSelect={onDelete}>
          <Trash size={16} />
          {translate(locale, 'editor.toolbar.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BreadcrumbTitle({
  entry,
  locale,
  loadingTitle,
  onRenameFilename,
}: Pick<BreadcrumbBarProps, 'entry' | 'locale' | 'loadingTitle' | 'onRenameFilename'>) {
  const typeLabel = entry.isA ?? 'Note'
  return (
    <div className="breadcrumb-bar__title-content flex items-center gap-1.5 min-w-0 text-sm text-muted-foreground">
      <span className="shrink-0">{typeLabel}</span>
      <span className="shrink-0 text-border">›</span>
      <div className="flex min-w-0 items-center gap-1 truncate">
        {loadingTitle
          ? <BreadcrumbTitleSkeleton />
          : <FilenameCrumb entry={entry} locale={locale} onRenameFilename={onRenameFilename} />}
      </div>
    </div>
  )
}

export const BreadcrumbBar = memo(function BreadcrumbBar({
  entry,
  barRef,
  locale = 'en',
  loadingTitle = false,
  onRenameFilename,
  ...actionProps
}: BreadcrumbBarProps) {
  const { onMouseDown } = useDragRegion()
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  const overflowCollapsed = useBreadcrumbOverflow(titleRef, actionsRef)

  return (
    <TooltipProvider>
      <div
        ref={barRef}
        data-tauri-drag-region
        data-title-hidden=""
        onMouseDown={onMouseDown}
        className="breadcrumb-bar flex shrink-0 items-center border-b border-transparent"
        style={{
          height: 52,
          background: 'var(--background)',
          padding: '6px 16px 6px var(--breadcrumb-bar-left-padding, 16px)',
          boxSizing: 'border-box',
        }}
      >
        <div ref={titleRef} className="breadcrumb-bar__title min-w-0 flex-1 overflow-hidden">
          <BreadcrumbTitle
            entry={entry}
            locale={locale}
            loadingTitle={loadingTitle}
            onRenameFilename={onRenameFilename}
          />
        </div>
        <div
          aria-hidden="true"
          data-tauri-drag-region
          className="breadcrumb-bar__drag-spacer w-6 shrink-0"
        />
        <BreadcrumbActions
          actionsRef={actionsRef}
          entry={entry}
          locale={locale}
          overflowCollapsed={overflowCollapsed}
          {...actionProps}
        />
      </div>
    </TooltipProvider>
  )
})
