import { type ComponentType, useState, useEffect, useRef } from 'react'
import type { SidebarSelection } from '../types'
import { cn } from '@/lib/utils'
import { getTypeColor, getTypeLightColor } from '../utils/typeColors'
import { type IconProps } from '@phosphor-icons/react'
import { SIDEBAR_ITEM_PADDING } from './sidebar/sidebarStyles'
import { Button } from './ui/button'
import { translate, type AppLocale } from '../lib/i18n'

const SIDEBAR_COUNT_PILL_STYLE = {
  borderRadius: 9999,
  padding: '0 6px',
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums',
} as const

export interface SectionGroup {
  label: string
  type: string
  Icon: ComponentType<IconProps>
  customColor?: string | null
}

function resolveSectionColors(type: string, customColor?: string | null) {
  return {
    sectionColor: getTypeColor(type, customColor),
    sectionLightColor: getTypeLightColor(type, customColor),
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- utility co-located with component
export function isSelectionActive(current: SidebarSelection, check: SidebarSelection): boolean {
  if (current.kind !== check.kind) return false
  switch (check.kind) {
    case 'filter': return (current as typeof check).filter === check.filter
    case 'sectionGroup': return (current as typeof check).type === check.type
    case 'folder': return (current as typeof check).path === check.path
    case 'entity': return (current as typeof check).entry.path === check.entry.path
    case 'view': return (current as typeof check).filename === check.filename
    default: return false
  }
}

// --- NavItem ---

function hasSidebarCount(count?: number): count is number {
  return count !== undefined && count > 0
}

function getNavItemPadding(compact: boolean | undefined, hasCount: boolean) {
  if (compact) return hasCount ? SIDEBAR_ITEM_PADDING.compactWithCount : SIDEBAR_ITEM_PADDING.compact
  return hasCount ? SIDEBAR_ITEM_PADDING.withCount : SIDEBAR_ITEM_PADDING.regular
}

function getNavItemIconSize(compact?: boolean) {
  return compact ? 14 : 16
}

function getNavItemTextClass(compact?: boolean) {
  return compact ? 'text-[12px]' : 'text-[13px]'
}

function resolveBadgeClassName(
  isActive: boolean | undefined,
  activeBadgeClassName: string | undefined,
  badgeClassName: string | undefined,
) {
  if (isActive && activeBadgeClassName) return activeBadgeClassName
  return badgeClassName
}

function resolveBadgeStyle(
  isActive: boolean | undefined,
  activeBadgeClassName: string | undefined,
  activeBadgeStyle: React.CSSProperties | undefined,
  badgeStyle: React.CSSProperties | undefined,
) {
  if (isActive && activeBadgeClassName) return activeBadgeStyle
  return badgeStyle
}

function SidebarNavIcon({
  Icon,
  emoji,
  iconSize,
  isActive,
}: {
  Icon: ComponentType<IconProps>
  emoji?: string | null
  iconSize: number
  isActive?: boolean
}) {
  if (emoji) return <span style={{ fontSize: iconSize, lineHeight: 1, width: iconSize, textAlign: 'center' }}>{emoji}</span>
  return <Icon size={iconSize} weight={isActive ? 'fill' : 'regular'} />
}

export function SidebarCountPill({
  count,
  className,
  style,
  compact,
  testId = 'sidebar-count-chip',
}: {
  count: number
  className?: string
  style?: React.CSSProperties
  compact?: boolean
  testId?: string
}) {
  return (
    <span
      data-testid={testId}
      className={cn("flex items-center justify-center", className)}
      style={{ height: compact ? 18 : 20, ...SIDEBAR_COUNT_PILL_STYLE, ...style }}
    >
      {count}
    </span>
  )
}

export function SidebarLoadingCountPill({ compact, testId = 'sidebar-count-skeleton' }: { compact?: boolean; testId?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className="inline-flex animate-pulse rounded-full bg-muted"
      style={{ width: compact ? 22 : 28, height: compact ? 18 : 20 }}
    />
  )
}

function NavItemLabel({ label, compact }: { label: string; compact?: boolean }) {
  return <span className={cn("flex-1 font-medium", getNavItemTextClass(compact))}>{label}</span>
}

function NavItemCount({
  count,
  countLoading,
  className,
  style,
  compact,
}: {
  count?: number
  countLoading?: boolean
  className?: string
  style?: React.CSSProperties
  compact?: boolean
}) {
  if (countLoading) return <SidebarLoadingCountPill compact={compact} />
  if (!hasSidebarCount(count)) return null
  return (
    <SidebarCountPill
      count={count}
      className={className}
      style={style}
      compact={compact}
    />
  )
}

function DisabledNavItem({
  Icon,
  emoji,
  label,
  compact,
  disabledTooltip,
  padding,
}: {
  Icon: ComponentType<IconProps>
  emoji?: string | null
  label: string
  compact?: boolean
  disabledTooltip?: string
  padding: ReturnType<typeof getNavItemPadding>
}) {
  return (
    <div className="flex select-none items-center gap-2 rounded text-foreground" style={{ padding, borderRadius: 4, opacity: 0.4, cursor: 'not-allowed' }} title={disabledTooltip ?? "Coming soon"}>
      <SidebarNavIcon Icon={Icon} emoji={emoji} iconSize={getNavItemIconSize(compact)} />
      <NavItemLabel label={label} compact={compact} />
    </div>
  )
}

function ClickableNavItem({
  Icon,
  emoji,
  label,
  count,
  countLoading,
  isActive,
  activeClassName,
  badgeClassName,
  badgeStyle,
  activeBadgeClassName,
  activeBadgeStyle,
  onClick,
  compact,
  padding,
}: {
  Icon: ComponentType<IconProps>
  emoji?: string | null
  label: string
  count?: number
  countLoading?: boolean
  isActive?: boolean
  activeClassName: string
  badgeClassName?: string
  badgeStyle?: React.CSSProperties
  activeBadgeClassName?: string
  activeBadgeStyle?: React.CSSProperties
  onClick?: () => void
  compact?: boolean
  padding: ReturnType<typeof getNavItemPadding>
}) {
  return (
    <div
      className={cn("flex cursor-pointer select-none items-center gap-2 rounded transition-colors", isActive ? activeClassName : "text-foreground hover:bg-accent")}
      style={{ padding, borderRadius: 4 }}
      onClick={onClick}
    >
      <SidebarNavIcon Icon={Icon} emoji={emoji} iconSize={getNavItemIconSize(compact)} isActive={isActive} />
      <NavItemLabel label={label} compact={compact} />
      <NavItemCount
        count={count}
        countLoading={countLoading}
        className={resolveBadgeClassName(isActive, activeBadgeClassName, badgeClassName)}
        style={resolveBadgeStyle(isActive, activeBadgeClassName, activeBadgeStyle, badgeStyle)}
        compact={compact}
      />
    </div>
  )
}

export function NavItem({ icon: Icon, emoji, label, count, countLoading, isActive, activeClassName = 'bg-primary/10 text-primary', badgeClassName, badgeStyle, activeBadgeClassName, activeBadgeStyle, onClick, disabled, disabledTooltip, compact }: {
  icon: ComponentType<IconProps>
  emoji?: string | null
  label: string
  count?: number
  countLoading?: boolean
  isActive?: boolean
  activeClassName?: string
  badgeClassName?: string
  badgeStyle?: React.CSSProperties
  activeBadgeClassName?: string
  activeBadgeStyle?: React.CSSProperties
  onClick?: () => void
  disabled?: boolean
  disabledTooltip?: string
  compact?: boolean
}) {
  const padding = getNavItemPadding(compact, countLoading || hasSidebarCount(count))
  if (disabled) {
    return (
      <DisabledNavItem
        Icon={Icon}
        emoji={emoji}
        label={label}
        compact={compact}
        disabledTooltip={disabledTooltip}
        padding={padding}
      />
    )
  }

  return (
    <ClickableNavItem
      Icon={Icon}
      emoji={emoji}
      label={label}
      count={count}
      countLoading={countLoading}
      isActive={isActive}
      activeClassName={activeClassName}
      badgeClassName={badgeClassName}
      badgeStyle={badgeStyle}
      activeBadgeClassName={activeBadgeClassName}
      activeBadgeStyle={activeBadgeStyle}
      onClick={onClick}
      compact={compact}
      padding={padding}
    />
  )
}

// --- Section Content ---

export interface SectionContentProps {
  group: SectionGroup
  itemCount: number
  selection: SidebarSelection
  onSelect: (sel: SidebarSelection) => void
  onContextMenu: (e: React.MouseEvent, type: string) => void
  dragHandleProps?: Record<string, unknown>
  isRenaming?: boolean
  renameInitialValue?: string
  onRenameSubmit?: (value: string) => void
  onRenameCancel?: () => void
  locale?: AppLocale
}

export function SectionContent({
  group, itemCount, selection, onSelect,
  onContextMenu, dragHandleProps,
  isRenaming, renameInitialValue, onRenameSubmit, onRenameCancel, locale,
}: SectionContentProps) {
  const { label, type, Icon, customColor } = group
  const { sectionColor, sectionLightColor } = resolveSectionColors(type, customColor)

  return (
    <SectionHeader
      label={label} type={type} Icon={Icon}
      sectionColor={sectionColor}
      sectionLightColor={sectionLightColor}
      itemCount={itemCount}
      isActive={isSelectionActive(selection, { kind: 'sectionGroup', type })}
      onSelect={() => onSelect({ kind: 'sectionGroup', type })}
      onContextMenu={(e) => onContextMenu(e, type)}
      dragHandleProps={dragHandleProps}
      isRenaming={isRenaming}
      renameInitialValue={renameInitialValue}
      onRenameSubmit={onRenameSubmit}
      onRenameCancel={onRenameCancel}
      locale={locale}
    />
  )
}

function InlineRenameInput({ initialValue, onSubmit, onCancel, locale }: {
  initialValue: string
  onSubmit: (value: string) => void
  onCancel: () => void
  locale?: AppLocale
}) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onSubmit(value.trim()) }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => onSubmit(value.trim())}
      onClick={(e) => e.stopPropagation()}
      aria-label={translate(locale ?? 'en', 'sidebar.section.name')}
      className="flex-1 rounded border border-primary bg-background text-[13px] font-medium text-foreground outline-none"
      style={{ padding: '1px 4px' }}
    />
  )
}

function getSectionHeaderBackground(isActive: boolean, sectionLightColor: string) {
  if (!isActive) return undefined
  return { background: sectionLightColor }
}

function getSectionHeaderIconWeight(isActive: boolean): IconProps['weight'] {
  return isActive ? 'fill' : 'regular'
}

function getSectionHeaderTitleColor(isActive: boolean, sectionColor: string) {
  if (!isActive) return undefined
  return sectionColor
}

function getSectionSelectHandler(isRenaming: boolean | undefined, onSelect: () => void) {
  if (isRenaming) return undefined
  return onSelect
}

function getSectionContextMenuHandler(
  isRenaming: boolean | undefined,
  onContextMenu: (e: React.MouseEvent) => void,
) {
  if (isRenaming) return undefined
  return onContextMenu
}

function resolveInlineRenameHandlers({
  isRenaming,
  onRenameCancel,
  onRenameSubmit,
}: {
  isRenaming?: boolean
  onRenameCancel?: () => void
  onRenameSubmit?: (value: string) => void
}): { onRenameCancel: () => void; onRenameSubmit: (value: string) => void } | null {
  if (!isRenaming || !onRenameSubmit || !onRenameCancel) return null
  return { onRenameCancel, onRenameSubmit }
}

function SectionHeaderLabel({
  type,
  label,
  isActive,
  sectionColor,
  isRenaming,
  renameInitialValue,
  onRenameSubmit,
  onRenameCancel,
  locale,
}: {
  type: string
  label: string
  isActive: boolean
  sectionColor: string
  isRenaming?: boolean
  renameInitialValue?: string
  onRenameSubmit?: (value: string) => void
  onRenameCancel?: () => void
  locale?: AppLocale
}) {
  const inlineRenameHandlers = resolveInlineRenameHandlers({
    isRenaming,
    onRenameCancel,
    onRenameSubmit,
  })

  if (inlineRenameHandlers) {
    return (
      <InlineRenameInput
        key={`rename-${type}`}
        initialValue={renameInitialValue ?? label}
        onSubmit={inlineRenameHandlers.onRenameSubmit}
        onCancel={inlineRenameHandlers.onRenameCancel}
        locale={locale}
      />
    )
  }

  return <span className="text-[13px] font-medium" style={{ marginLeft: 4, color: getSectionHeaderTitleColor(isActive, sectionColor) }}>{label}</span>
}

function SectionHeaderCountPill({
  itemCount,
  isActive,
  sectionColor,
}: {
  itemCount: number
  isActive: boolean
  sectionColor: string
}) {
  if (itemCount <= 0) return null
  return (
    <SidebarCountPill
      count={itemCount}
      className={!isActive ? 'text-muted-foreground' : undefined}
      style={isActive ? { background: sectionColor, color: 'var(--text-inverse)' } : { background: 'var(--muted)' }}
    />
  )
}

function SectionHeader({ label, type, Icon, sectionColor, sectionLightColor, itemCount, isActive, onSelect, onContextMenu, dragHandleProps, isRenaming, renameInitialValue, onRenameSubmit, onRenameCancel, locale }: {
  label: string; type: string; Icon: ComponentType<IconProps>
  sectionColor: string; sectionLightColor: string; itemCount: number; isActive: boolean
  onSelect: () => void; onContextMenu: (e: React.MouseEvent) => void
  dragHandleProps?: Record<string, unknown>
  isRenaming?: boolean; renameInitialValue?: string
  onRenameSubmit?: (value: string) => void; onRenameCancel?: () => void
  locale?: AppLocale
}) {
  return (
    <div
      className={cn("group/section flex cursor-pointer select-none items-center justify-between rounded transition-colors", !isActive && "hover:bg-accent")}
      style={{ padding: '6px 8px 6px 16px', borderRadius: 4, gap: 4, ...getSectionHeaderBackground(isActive, sectionLightColor) }}
      {...dragHandleProps}
      onClick={getSectionSelectHandler(isRenaming, onSelect)}
      onContextMenu={getSectionContextMenuHandler(isRenaming, onContextMenu)}
    >
      <div className="flex min-w-0 flex-1 items-center" style={{ gap: 4 }}>
        <Icon size={16} weight={getSectionHeaderIconWeight(isActive)} style={{ color: sectionColor, flexShrink: 0 }} />
        <SectionHeaderLabel
          type={type}
          label={label}
          isActive={isActive}
          sectionColor={sectionColor}
          isRenaming={isRenaming}
          renameInitialValue={renameInitialValue}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          locale={locale}
        />
      </div>
      <SectionHeaderCountPill itemCount={itemCount} isActive={isActive} sectionColor={sectionColor} />
    </div>
  )
}

function VisibilityPopoverItem({
  group,
  isVisible,
  onToggle,
  locale = 'en',
}: {
  group: SectionGroup
  isVisible: boolean
  onToggle: (type: string) => void
  locale?: AppLocale
}) {
  const { label, type, Icon, customColor } = group
  const { sectionColor } = resolveSectionColors(type, customColor)

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto w-full justify-start rounded-none px-3 py-1.5"
      style={{ padding: '6px 12px', gap: 8 }}
      onClick={() => onToggle(type)}
      aria-label={translate(locale, 'sidebar.section.toggle', { label })}
    >
      <Icon size={14} style={{ color: sectionColor }} />
      <span className="flex-1 text-left text-[13px] text-foreground">{label}</span>
      <ToggleSwitch on={isVisible} />
    </Button>
  )
}

// --- Visibility Popover ---

export function VisibilityPopover({ sections, isSectionVisible, onToggle, locale = 'en' }: {
  sections: SectionGroup[]
  isSectionVisible: (type: string) => boolean
  onToggle: (type: string) => void
  locale?: AppLocale
}) {
  return (
    <div
      className="border border-border bg-popover text-popover-foreground"
      style={{ position: 'absolute', top: '100%', left: 6, right: 6, zIndex: 50, borderRadius: 8, padding: '8px 0', boxShadow: '0 4px 12px var(--shadow-dialog)' }}
    >
      <div className="text-[12px] font-semibold text-muted-foreground" style={{ padding: '0 12px 4px' }}>{translate(locale, 'sidebar.section.showInSidebar')}</div>
      {sections.map((group) => (
        <VisibilityPopoverItem
          key={group.type}
          group={group}
          isVisible={isSectionVisible(group.type)}
          onToggle={onToggle}
          locale={locale}
        />
      ))}
    </div>
  )
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <div className="flex items-center" style={{ width: 32, height: 18, borderRadius: 9, padding: 2, backgroundColor: on ? 'var(--primary)' : 'var(--muted)', justifyContent: on ? 'flex-end' : 'flex-start', transition: 'background-color 150ms' }}>
      <div style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: 'var(--background)', transition: 'transform 150ms' }} />
    </div>
  )
}
