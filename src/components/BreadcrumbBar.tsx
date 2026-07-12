import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react'
import type { NoteWidthMode, VaultEntry } from '../types'
import { cn } from '@/lib/utils'
import { translate, type AppLocale } from '../lib/i18n'
import { APP_COMMAND_IDS, formatShortcutDisplay, getAppCommandShortcutDisplay } from '../hooks/appCommandCatalog'
import { extractFrontmatterTitleFromContent, extractH1TitleFromContent } from '../utils/noteTitle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ActionTooltip, type ActionTooltipCopy } from '@/components/ui/action-tooltip'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspaceInitialsBadge } from './WorkspaceInitialsBadge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  GitBranch,
  Code,
  ListBullets,
  SidebarSimple,
  Trash,
  Archive,
  ArrowUUpLeft,
  ClipboardText,
  FilePdf,
  FolderOpen,
  Link,
  MapTrifold,
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
  showTableOfContents?: boolean
  onToggleTableOfContents?: () => void
  inspectorCollapsed?: boolean
  onToggleInspector?: () => void
  onToggleFavorite?: () => void
  onToggleOrganized?: () => void
  onRevealFile?: (path: string) => void
  onCopyFilePath?: (path: string) => void
  onCopyDeepLink?: (entry: VaultEntry) => void
  onCopyGitUrl?: (entry: VaultEntry) => void
  onExportPdf?: () => void
  onDelete?: () => void
  onArchive?: () => void
  onUnarchive?: () => void
  onEnterNeighborhood?: (entry: VaultEntry) => void
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  noteWidth?: NoteWidthMode
  onToggleNoteWidth?: () => void
  /** Ref for direct DOM manipulation — avoids re-render on scroll. */
  barRef?: React.Ref<HTMLDivElement>
  locale?: AppLocale
  loadingTitle?: boolean
  content?: string | null
}

const BREADCRUMB_ICON_CLASS = 'size-[16px]'
const TITLE_ACTION_GAP_PX = 24

interface BreadcrumbTooltipController {
  activeTooltipLabel: string | null
  setActiveTooltipLabel: Dispatch<SetStateAction<string | null>>
}

interface BreadcrumbTooltipControl {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
  onFocus?: () => void
  onBlur?: () => void
}

const BreadcrumbTooltipContext = createContext<BreadcrumbTooltipController | null>(null)

function clearBreadcrumbTooltip(controller: BreadcrumbTooltipController, label: string) {
  controller.setActiveTooltipLabel((current) => current === label ? null : current)
}

function setBreadcrumbTooltipOpen(controller: BreadcrumbTooltipController, label: string, open: boolean) {
  if (open) {
    controller.setActiveTooltipLabel(label)
    return
  }
  clearBreadcrumbTooltip(controller, label)
}

function useBreadcrumbTooltipControl(label: string): BreadcrumbTooltipControl {
  const controller = useContext(BreadcrumbTooltipContext)
  const activate = useCallback(() => {
    controller?.setActiveTooltipLabel(label)
  }, [controller, label])
  const deactivate = useCallback(() => {
    if (!controller) return
    clearBreadcrumbTooltip(controller, label)
  }, [controller, label])
  const onOpenChange = useCallback((open: boolean) => {
    if (!controller) return
    setBreadcrumbTooltipOpen(controller, label, open)
  }, [controller, label])

  if (!controller) {
    return {}
  }

  return {
    open: controller.activeTooltipLabel === label,
    onOpenChange,
    onPointerEnter: activate,
    onPointerLeave: deactivate,
    onFocus: activate,
    onBlur: deactivate,
  }
}

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
  const tooltipControl = useBreadcrumbTooltipControl(copy.label)

  return (
    <ActionTooltip
      copy={copy}
      side="bottom"
      align={tooltipAlign}
      open={tooltipControl.open}
      onOpenChange={tooltipControl.onOpenChange}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className={cn('text-muted-foreground [&_svg:not([class*=size-])]:size-4', className)}
        style={style}
        onClick={onClick}
        onPointerEnter={tooltipControl.onPointerEnter}
        onPointerLeave={tooltipControl.onPointerLeave}
        onFocus={tooltipControl.onFocus}
        onBlur={tooltipControl.onBlur}
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

function NeighborhoodAction({
  entry,
  locale = 'en',
  onEnterNeighborhood,
}: Pick<BreadcrumbBarProps, 'entry' | 'locale' | 'onEnterNeighborhood'>) {
  if (!onEnterNeighborhood) return null

  return (
    <IconActionButton
      copy={{ label: translate(locale, 'editor.toolbar.openNeighborhood') }}
      onClick={() => onEnterNeighborhood(entry)}
      className="hover:text-foreground"
    >
      <MapTrifold size={16} className={BREADCRUMB_ICON_CLASS} />
    </IconActionButton>
  )
}

function TableOfContentsAction({
  showTableOfContents,
  locale = 'en',
  onToggleTableOfContents,
}: Pick<BreadcrumbBarProps, 'showTableOfContents' | 'locale' | 'onToggleTableOfContents'>) {
  if (!onToggleTableOfContents) return null

  return (
    <IconActionButton
      copy={{
        label: translate(locale, showTableOfContents ? 'editor.toolbar.closeTableOfContents' : 'editor.toolbar.openTableOfContents'),
        shortcut: getAppCommandShortcutDisplay(APP_COMMAND_IDS.viewToggleTableOfContents),
      }}
      onClick={onToggleTableOfContents}
      className={cn(showTableOfContents ? 'text-foreground' : 'hover:text-foreground')}
    >
      <ListBullets size={16} weight={showTableOfContents ? 'bold' : 'regular'} className={BREADCRUMB_ICON_CLASS} />
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
      testId="breadcrumb-properties-button"
      tooltipAlign="end"
    >
      <SidebarSimple size={16} weight="regular" className={BREADCRUMB_ICON_CLASS} />
    </IconActionButton>
  )
}

function OverflowToolbarAction({ children }: { children: ReactNode }) {
  return <span className="breadcrumb-bar__overflowable-action flex items-center gap-2">{children}</span>
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

function entryAction(action: ((entry: VaultEntry) => void) | undefined, entry: VaultEntry): (() => void) | undefined {
  return action ? () => action(entry) : undefined
}

function ArchiveMenuIcon({ archived }: { archived: boolean }) {
  return archived ? <ArrowUUpLeft size={16} /> : <Archive size={16} />
}

function neighborhoodAction(
  entry: VaultEntry,
  onEnterNeighborhood?: (entry: VaultEntry) => void,
): (() => void) | undefined {
  return onEnterNeighborhood ? () => onEnterNeighborhood(entry) : undefined
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

  const clone = titleContent.cloneNode(true)
  if (!(clone instanceof HTMLElement)) return readElementWidth(title)

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

function withExpandedActionMeasurement<T>(
  actions: HTMLDivElement,
  collapsed: boolean,
  measure: () => T,
): T {
  if (!collapsed) return measure()

  const previousValue = actions.getAttribute('data-overflow-collapsed')
  // Probe the expanded geometry; measuring the collapsed layout can oscillate.
  actions.setAttribute('data-overflow-collapsed', 'false')
  try {
    return measure()
  } finally {
    if (previousValue === null) {
      actions.removeAttribute('data-overflow-collapsed')
    } else {
      actions.setAttribute('data-overflow-collapsed', previousValue)
    }
  }
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
    const bar = title?.closest('.breadcrumb-bar')
    if (!title || !actions || !(bar instanceof HTMLDivElement)) return undefined

    let frame = 0
    const measure = () => {
      const nextCollapsed = withExpandedActionMeasurement(actions, collapsed, () => {
        const expandedActionsWidth = actions.scrollWidth || expandedActionsWidthRef.current
        expandedActionsWidthRef.current = expandedActionsWidth
        return shouldCollapseBreadcrumbOverflow(title, actions, expandedActionsWidth)
      })
      setCollapsed((current) => current === nextCollapsed ? current : nextCollapsed)
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

function deriveSyncStem(entry: VaultEntry, content?: string | null): string | null {
  const titleState = deriveContentDisplayTitleState(content) ?? deriveEntryDisplayTitleState(entry)
  const expectedStem = slugify(titleState.title.trim())
  const filenameStem = entry.filename.replace(/\.md$/, '')
  if (!expectedStem || expectedStem === filenameStem) return null
  return expectedStem
}

interface BreadcrumbDisplayTitleState {
  hasH1: boolean
  title: string
}

function deriveContentDisplayTitleState(content?: string | null): BreadcrumbDisplayTitleState | null {
  if (typeof content !== 'string') return null
  const h1Title = extractH1TitleFromContent(content)
  if (h1Title) return { title: h1Title, hasH1: true }

  const frontmatterTitle = extractFrontmatterTitleFromContent(content)
  return frontmatterTitle ? { title: frontmatterTitle, hasH1: false } : null
}

function deriveEntryDisplayTitleState(entry: VaultEntry): BreadcrumbDisplayTitleState {
  return {
    title: entry.title.trim(),
    hasH1: entry.hasH1,
  }
}

function deriveBreadcrumbDisplayTitle(entry: VaultEntry, filenameStem: string, content?: string | null): string | null {
  const displayState = deriveContentDisplayTitleState(content) ?? deriveEntryDisplayTitleState(entry)
  const displayTitle = displayState.title.trim()
  if (!displayTitle || displayState.hasH1) return null
  if (slugify(displayTitle) === slugify(filenameStem)) return null
  return displayTitle
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
  const tooltipLabel = translate(locale, 'editor.filename.renameToTitle')
  const tooltipControl = useBreadcrumbTooltipControl(tooltipLabel)

  if (!syncStem || !onRenameFilename) return null
  return (
    <ActionTooltip
      copy={{ label: tooltipLabel }}
      side="bottom"
      open={tooltipControl.open}
      onOpenChange={tooltipControl.onOpenChange}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => onRenameFilename(entryPath, syncStem)}
        data-testid="breadcrumb-sync-button"
        aria-label={tooltipLabel}
        onPointerEnter={tooltipControl.onPointerEnter}
        onPointerLeave={tooltipControl.onPointerLeave}
        onFocus={tooltipControl.onFocus}
        onBlur={tooltipControl.onBlur}
      >
        <ArrowsClockwise size={14} />
      </Button>
    </ActionTooltip>
  )
}

function FilenameDisplay({
  content,
  entry,
  filenameStem,
  syncStem,
  locale,
  onRenameFilename,
  onStartEditing,
}: {
  content?: string | null
  entry: VaultEntry
  filenameStem: string
  syncStem: string | null
  locale?: AppLocale
  onRenameFilename?: (path: string, newFilenameStem: string) => void
  onStartEditing: () => void
}) {
  const displayTitle = deriveBreadcrumbDisplayTitle(entry, filenameStem, content)

  return (
    <div className="flex min-w-0 items-center gap-1">
      {displayTitle && (
        <>
          <span
            className="min-w-0 max-w-[min(24rem,45vw)] truncate text-foreground"
            data-testid="breadcrumb-display-title"
            title={displayTitle}
          >
            {displayTitle}
          </span>
          <span aria-hidden="true" className="shrink-0 text-border">·</span>
        </>
      )}
      <FilenameTrigger filenameStem={filenameStem} locale={locale} onStartEditing={onStartEditing} />
      <SyncFilenameButton entryPath={entry.path} syncStem={syncStem} locale={locale} onRenameFilename={onRenameFilename} />
    </div>
  )
}

function FilenameCrumb({ content, entry, locale = 'en', onRenameFilename }: Pick<BreadcrumbBarProps, 'content' | 'entry' | 'locale' | 'onRenameFilename'>) {
  const filenameStem = useMemo(() => entry.filename.replace(/\.md$/, ''), [entry.filename])
  const syncStem = useMemo(() => deriveSyncStem(entry, content), [entry, content])
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
      content={content}
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
  onToggleDiff,
  rawMode,
  onToggleRaw,
  forceRawMode,
  noteWidth,
  onToggleNoteWidth,
  showTableOfContents,
  onToggleTableOfContents,
  inspectorCollapsed,
  onToggleInspector,
  onToggleFavorite,
  onToggleOrganized,
  onRevealFile,
  onCopyFilePath,
  onCopyDeepLink,
  onCopyGitUrl,
  onExportPdf,
  onDelete,
  onArchive,
  onUnarchive,
  onEnterNeighborhood,
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
        <NeighborhoodAction entry={entry} locale={locale} onEnterNeighborhood={onEnterNeighborhood} />
      </OverflowToolbarAction>
      {!forceRawMode && <RawToggleButton rawMode={rawMode} locale={locale} onToggleRaw={onToggleRaw} />}
      <OverflowToolbarAction>
        <NoteWidthAction noteWidth={noteWidth} locale={locale} onToggleNoteWidth={onToggleNoteWidth} />
      </OverflowToolbarAction>
      <OverflowToolbarAction>
        <TableOfContentsAction
          showTableOfContents={showTableOfContents}
          locale={locale}
          onToggleTableOfContents={onToggleTableOfContents}
        />
      </OverflowToolbarAction>
      <OverflowToolbarAction>
        <FilePathActions entry={entry} locale={locale} onRevealFile={onRevealFile} onCopyFilePath={onCopyFilePath} />
      </OverflowToolbarAction>
      <BreadcrumbOverflowMenu
        entry={entry}
        showDiffToggle={showDiffToggle}
        onToggleDiff={onToggleDiff}
        noteWidth={noteWidth}
        onToggleNoteWidth={onToggleNoteWidth}
        showTableOfContents={showTableOfContents}
        onToggleTableOfContents={onToggleTableOfContents}
        onRevealFile={onRevealFile}
        onCopyFilePath={onCopyFilePath}
        onCopyDeepLink={onCopyDeepLink}
        onCopyGitUrl={onCopyGitUrl}
        onExportPdf={onExportPdf}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onDelete={onDelete}
        onEnterNeighborhood={onEnterNeighborhood}
        showResponsiveActions={overflowCollapsed}
        locale={locale}
      />
      <InspectorAction inspectorCollapsed={inspectorCollapsed} locale={locale} onToggleInspector={onToggleInspector} />
    </div>
  )
}

function BreadcrumbOverflowMenu({
  entry,
  showDiffToggle,
  onToggleDiff,
  noteWidth,
  onToggleNoteWidth,
  showTableOfContents,
  onToggleTableOfContents,
  onRevealFile,
  onCopyFilePath,
  onCopyDeepLink,
  onCopyGitUrl,
  onExportPdf,
  onArchive,
  onUnarchive,
  onDelete,
  onEnterNeighborhood,
  showResponsiveActions,
  locale = 'en',
}: Pick<
  BreadcrumbBarProps,
  | 'entry'
  | 'showDiffToggle'
  | 'onToggleDiff'
  | 'noteWidth'
  | 'onToggleNoteWidth'
  | 'showTableOfContents'
  | 'onToggleTableOfContents'
  | 'onRevealFile'
  | 'onCopyFilePath'
  | 'onCopyDeepLink'
  | 'onCopyGitUrl'
  | 'onExportPdf'
  | 'onArchive'
  | 'onUnarchive'
  | 'onDelete'
  | 'onEnterNeighborhood'
  | 'locale'
> & {
  showResponsiveActions: boolean
}) {
  const runDiffAction = availableDiffAction(showDiffToggle, onToggleDiff)
  const runRevealAction = pathAction(onRevealFile, entry.path)
  const runCopyPathAction = pathAction(onCopyFilePath, entry.path)
  const runCopyDeepLinkAction = entryAction(onCopyDeepLink, entry)
  const runArchiveAction = archiveAction(entry.archived, onArchive, onUnarchive)
  const runNeighborhoodAction = neighborhoodAction(entry, onEnterNeighborhood)
  const diffLabel = translate(locale, 'editor.toolbar.gitDiff')
  const exportPdfLabel = translate(locale, 'editor.toolbar.exportPdf')
  const noteWidthLabel = translate(locale, noteWidthLabelKey(noteWidth))
  const archiveLabel = translate(locale, archiveLabelKey(entry.archived))
  const tableOfContentsLabel = translate(locale, showTableOfContents ? 'editor.toolbar.closeTableOfContents' : 'editor.toolbar.openTableOfContents')
  const neighborhoodLabel = translate(locale, 'editor.toolbar.openNeighborhood')
  const moreActionsLabel = translate(locale, 'editor.toolbar.moreActions')

  return (
    <DropdownMenu>
      <BreadcrumbOverflowMenuTrigger label={moreActionsLabel} />
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem disabled={!runDiffAction} onSelect={runDiffAction}>
          <GitBranch size={16} />
          {diffLabel}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!onExportPdf} onSelect={onExportPdf}>
          <FilePdf size={16} />
          {exportPdfLabel}
        </DropdownMenuItem>
        {showResponsiveActions && (
          <>
            <DropdownMenuItem disabled={!runNeighborhoodAction} onSelect={runNeighborhoodAction}>
              <MapTrifold size={16} />
              {neighborhoodLabel}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onToggleNoteWidth} onSelect={onToggleNoteWidth}>
              <NoteWidthMenuIcon noteWidth={noteWidth} />
              {noteWidthLabel}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onToggleTableOfContents} onSelect={onToggleTableOfContents}>
              <ListBullets size={16} />
              {tableOfContentsLabel}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!runRevealAction} onSelect={runRevealAction}>
              <FolderOpen size={16} />
              {translate(locale, 'editor.toolbar.revealFile')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!runCopyPathAction} onSelect={runCopyPathAction}>
              <ClipboardText size={16} />
              {translate(locale, 'editor.toolbar.copyFilePath')}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem disabled={!runCopyDeepLinkAction} onSelect={runCopyDeepLinkAction}>
          <Link size={16} />
          {translate(locale, 'editor.toolbar.copyNoteDeepLink')}
        </DropdownMenuItem>
        <CopyGitUrlMenuItem action={entryAction(onCopyGitUrl, entry)} locale={locale} />
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

function BreadcrumbOverflowMenuTrigger({ label }: { label: string }) {
  const tooltipControl = useBreadcrumbTooltipControl(label)

  return (
    <ActionTooltip
      copy={{ label }}
      side="bottom"
      align="end"
      open={tooltipControl.open}
      onOpenChange={tooltipControl.onOpenChange}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="breadcrumb-bar__overflow-menu text-muted-foreground hover:text-foreground"
          aria-label={label}
          data-testid="breadcrumb-overflow-menu-trigger"
          onPointerEnter={tooltipControl.onPointerEnter}
          onPointerLeave={tooltipControl.onPointerLeave}
          onFocus={tooltipControl.onFocus}
          onBlur={tooltipControl.onBlur}
        >
          <DotsThree size={18} weight="bold" className={BREADCRUMB_ICON_CLASS} />
        </Button>
      </DropdownMenuTrigger>
    </ActionTooltip>
  )
}

function CopyGitUrlMenuItem({
  action,
  locale,
}: {
  action: (() => void) | undefined
  locale: AppLocale
}) {
  if (!action) return null
  return (
    <DropdownMenuItem onSelect={action}>
      <GitBranch size={16} />
      {translate(locale, 'editor.toolbar.copyNoteGitUrl')}
    </DropdownMenuItem>
  )
}

function BreadcrumbSeparator() {
  return <span aria-hidden="true" className="shrink-0 text-border">›</span>
}

function WorkspaceCrumb({ entry }: Pick<BreadcrumbBarProps, 'entry'>) {
  const workspace = entry.workspace
  if (!workspace) return null

  return (
    <>
      <WorkspaceInitialsBadge
        className="shrink-0"
        testId="breadcrumb-workspace-label"
        workspace={workspace}
      />
      <BreadcrumbSeparator />
    </>
  )
}

function BreadcrumbTitle({
  content,
  entry,
  locale,
  loadingTitle,
  onRenameFilename,
}: Pick<BreadcrumbBarProps, 'content' | 'entry' | 'locale' | 'loadingTitle' | 'onRenameFilename'>) {
  const typeLabel = entry.isA ?? 'Note'
  return (
    <div className="breadcrumb-bar__title-content flex items-center gap-1.5 min-w-0 text-sm text-muted-foreground">
      <WorkspaceCrumb entry={entry} />
      <span className="shrink-0">{typeLabel}</span>
      <BreadcrumbSeparator />
      <div className="flex min-w-0 items-center gap-1 truncate">
        {loadingTitle
          ? <BreadcrumbTitleSkeleton />
          : <FilenameCrumb content={content} entry={entry} locale={locale} onRenameFilename={onRenameFilename} />}
      </div>
    </div>
  )
}

export const BreadcrumbBar = memo(function BreadcrumbBar({
  content,
  entry,
  barRef,
  locale = 'en',
  loadingTitle = false,
  onRenameFilename,
  ...actionProps
}: BreadcrumbBarProps) {
  type DragRegionResult = ReturnType<typeof useDragRegion<HTMLDivElement>> & {
    dragRegionRef?: React.RefObject<HTMLDivElement | null>
  }
  const { dragRegionRef, onMouseDown } = useDragRegion<HTMLDivElement>() as DragRegionResult
  const fallbackDragRegionRef = useRef<HTMLDivElement>(null)
  const breadcrumbDragRegionRef = dragRegionRef ?? fallbackDragRegionRef
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  const overflowCollapsed = useBreadcrumbOverflow(titleRef, actionsRef)
  const [activeTooltipLabel, setActiveTooltipLabel] = useState<string | null>(null)
  const tooltipController = useMemo(() => ({
    activeTooltipLabel,
    setActiveTooltipLabel,
  }), [activeTooltipLabel])
  useImperativeHandle(barRef, () => breadcrumbDragRegionRef.current as HTMLDivElement, [breadcrumbDragRegionRef])

  useEffect(() => {
    if (dragRegionRef) return
    const bar = fallbackDragRegionRef.current
    if (!bar) return

    bar.addEventListener('mousedown', onMouseDown)
    return () => bar.removeEventListener('mousedown', onMouseDown)
  }, [dragRegionRef, onMouseDown])

  return (
    <TooltipProvider>
      <BreadcrumbTooltipContext.Provider value={tooltipController}>
        <div
          ref={breadcrumbDragRegionRef}
          data-tauri-drag-region
          data-title-hidden=""
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
              content={content}
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
      </BreadcrumbTooltipContext.Provider>
    </TooltipProvider>
  )
})
