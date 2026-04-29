import type { MouseEvent, ReactNode } from 'react'
import { Folder, Funnel, Plus } from '@phosphor-icons/react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate, type AppLocale } from '../../lib/i18n'
import { SidebarGroupHeader } from './SidebarGroupHeader'

interface SidebarLoadingSectionsProps {
  collapsed: boolean
  locale?: AppLocale
  onToggle: () => void
}

interface SidebarLoadingActionProps {
  label: string
  onClick?: () => void
  testId?: string
  children: ReactNode
}

interface SidebarLoadingRowProps {
  icon?: ReactNode
  iconColor?: string
  labelWidth: number
  showCount?: boolean
}

interface SidebarLoadingSectionProps extends SidebarLoadingSectionsProps {
  label: string
  rows: SidebarLoadingRowProps[]
  testId: string
  children?: ReactNode
}

interface CreatableLoadingSectionProps extends SidebarLoadingSectionsProps {
  actionLabel: string
  actionTestId?: string
  label: string
  onCreate?: () => void
  rows: SidebarLoadingRowProps[]
  testId: string
}

interface CreatableLoadingSectionConfig {
  actionLabelKey: Parameters<typeof translate>[1]
  actionTestId?: string
  labelKey: Parameters<typeof translate>[1]
  rows: SidebarLoadingRowProps[]
  testId: string
}

const FAVORITE_ROWS = [
  { iconColor: 'var(--accent-yellow)', labelWidth: 132 },
  { iconColor: 'var(--accent-red)', labelWidth: 118 },
]

const VIEW_ROWS = [
  { icon: <Funnel size={16} />, labelWidth: 118 },
  { icon: <Funnel size={16} />, labelWidth: 146, showCount: true },
]

const TYPE_ROWS = [
  { iconColor: 'var(--accent-red)', labelWidth: 72, showCount: true },
  { iconColor: 'var(--accent-orange)', labelWidth: 92, showCount: true },
  { iconColor: 'var(--accent-purple)', labelWidth: 104, showCount: true },
  { iconColor: 'var(--accent-blue)', labelWidth: 126, showCount: true },
  { iconColor: 'var(--accent-green)', labelWidth: 112, showCount: true },
  { iconColor: 'var(--accent-yellow)', labelWidth: 96, showCount: true },
]

const FOLDER_ROWS = [
  { icon: <Folder size={16} />, labelWidth: 118 },
  { icon: <Folder size={16} />, labelWidth: 92 },
]

type CreatableLoadingSectionKind = 'views' | 'folders'

const CREATABLE_LOADING_SECTIONS: Record<CreatableLoadingSectionKind, CreatableLoadingSectionConfig> = {
  views: {
    actionLabelKey: 'sidebar.action.createView',
    labelKey: 'sidebar.group.views',
    rows: VIEW_ROWS,
    testId: 'sidebar-loading-views',
  },
  folders: {
    actionLabelKey: 'sidebar.action.createFolder',
    actionTestId: 'create-folder-btn',
    labelKey: 'sidebar.group.folders',
    rows: FOLDER_ROWS,
    testId: 'sidebar-loading-folders',
  },
}

interface ConfiguredCreatableLoadingSectionProps extends SidebarLoadingSectionsProps {
  kind: CreatableLoadingSectionKind
  onCreate?: () => void
}

function SidebarLoadingAction({
  label,
  onClick,
  testId,
  children,
}: SidebarLoadingActionProps) {
  const handleClick = onClick
    ? (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        onClick()
      }
    : undefined

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="h-auto w-auto min-w-0 rounded-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
      data-testid={testId}
      title={label}
      aria-label={label}
      aria-disabled={onClick ? undefined : true}
      onClick={handleClick}
    >
      {children}
    </Button>
  )
}

function SidebarLoadingIcon({ icon, iconColor }: Pick<SidebarLoadingRowProps, 'icon' | 'iconColor'>) {
  if (icon) return <span className="shrink-0 text-muted-foreground">{icon}</span>

  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 shrink-0 rounded-sm"
      style={{ background: iconColor ?? 'var(--muted)' }}
    />
  )
}

function SidebarLoadingBar({ width }: { width: number }) {
  return (
    <span
      aria-hidden="true"
      className="h-3.5 rounded bg-muted"
      style={{ width }}
    />
  )
}

function SidebarLoadingRow({
  icon,
  iconColor,
  labelWidth,
  showCount,
}: SidebarLoadingRowProps) {
  return (
    <div
      className="flex select-none items-center gap-2 rounded"
      style={{ padding: '6px 8px 6px 16px', borderRadius: 4 }}
    >
      <SidebarLoadingIcon icon={icon} iconColor={iconColor} />
      <div className="flex min-w-0 flex-1 items-center">
        <SidebarLoadingBar width={labelWidth} />
      </div>
      {showCount && <span aria-hidden="true" className="h-5 w-7 rounded-full bg-muted" />}
    </div>
  )
}

function SidebarLoadingSection({
  label,
  collapsed,
  onToggle,
  rows,
  testId,
  children,
}: SidebarLoadingSectionProps) {
  return (
    <div className="border-b border-border" data-testid={testId} style={{ padding: '0 6px' }}>
      <SidebarGroupHeader label={label} collapsed={collapsed} onToggle={onToggle}>
        {children}
      </SidebarGroupHeader>
      {!collapsed && (
        <div className="flex flex-col gap-0.5 pb-2 animate-pulse" aria-hidden="true">
          {rows.map((row, index) => (
            <SidebarLoadingRow key={`${testId}-${index}`} {...row} />
          ))}
        </div>
      )}
    </div>
  )
}

export function SidebarFavoritesLoadingSection(props: SidebarLoadingSectionsProps) {
  return (
    <SidebarLoadingSection
      {...props}
      label={translate(props.locale ?? 'en', 'sidebar.group.favorites')}
      rows={FAVORITE_ROWS}
      testId="sidebar-loading-favorites"
    />
  )
}

export function SidebarCreatableLoadingSection({
  kind,
  onCreate,
  ...props
}: ConfiguredCreatableLoadingSectionProps) {
  const config = CREATABLE_LOADING_SECTIONS[kind]
  const locale = props.locale ?? 'en'
  return (
    <CreatableLoadingSection
      {...props}
      actionLabel={translate(locale, config.actionLabelKey)}
      actionTestId={config.actionTestId}
      label={translate(locale, config.labelKey)}
      onCreate={onCreate}
      rows={config.rows}
      testId={config.testId}
    />
  )
}

function CreatableLoadingSection({
  actionLabel,
  actionTestId,
  label,
  onCreate,
  rows,
  testId,
  ...props
}: CreatableLoadingSectionProps) {
  return (
    <SidebarLoadingSection
      {...props}
      label={label}
      rows={rows}
      testId={testId}
    >
      {onCreate && (
        <SidebarLoadingAction label={actionLabel} onClick={onCreate} testId={actionTestId}>
          <Plus size={12} className="text-muted-foreground hover:text-foreground" />
        </SidebarLoadingAction>
      )}
    </SidebarLoadingSection>
  )
}

export function SidebarTypesLoadingSection({
  onCreateNewType,
  ...props
}: SidebarLoadingSectionsProps & {
  onCreateNewType?: () => void
}) {
  const locale = props.locale ?? 'en'
  return (
    <SidebarLoadingSection
      {...props}
      label={translate(locale, 'sidebar.group.types')}
      rows={TYPE_ROWS}
      testId="sidebar-loading-types"
    >
      <div className="flex items-center gap-1.5">
        <SidebarLoadingAction label={translate(locale, 'sidebar.action.customizeSections')}>
          <SlidersHorizontal size={12} className="text-muted-foreground" />
        </SidebarLoadingAction>
        {onCreateNewType && (
          <SidebarLoadingAction label={translate(locale, 'sidebar.action.createType')} onClick={onCreateNewType} testId="create-type-btn">
            <Plus size={12} className="text-muted-foreground hover:text-foreground" />
          </SidebarLoadingAction>
        )}
      </div>
    </SidebarLoadingSection>
  )
}
