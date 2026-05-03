import type { ReactNode } from 'react'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import { Switch } from './ui/switch'

type SelectOption = { value: string; label: string }
type ControlWidth = 'auto' | 'compact' | 'default' | 'wide'

const SETTINGS_GROUP_ITEM_CLASS = 'border-b border-border px-4 py-3 last:border-b-0'

function sanitizePositiveInteger(value: number | null | undefined, fallback: number): number {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 1) return fallback
  return Math.round(value)
}

export function SettingsSection({
  children,
  id,
}: {
  children: ReactNode
  id?: string
  showDivider?: boolean
}) {
  return (
    <div id={id} className="scroll-mt-4" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 0' }}>
      {children}
    </div>
  )
}

export function SectionHeading({
  title,
}: {
  title: string
  description?: string
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--foreground)',
        }}
      >
        {title}
      </div>
    </div>
  )
}

export function SettingsGroup({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-md border border-border bg-card">{children}</div>
}

export function SettingsGroupItem({
  children,
  testId,
}: {
  children: ReactNode
  testId?: string
}) {
  return <div className={SETTINGS_GROUP_ITEM_CLASS} data-testid={testId}>{children}</div>
}

function controlWidthClass(width: ControlWidth): string {
  if (width === 'auto') return 'lg:w-auto'
  if (width === 'compact') return 'lg:w-56'
  if (width === 'wide') return 'lg:w-[420px]'
  return 'lg:w-80'
}

export function SettingsRow({
  label,
  description,
  children,
  controlWidth = 'default',
  testId,
}: {
  label: string
  description?: string
  children: ReactNode
  controlWidth?: ControlWidth
  testId?: string
}) {
  return (
    <div
      className={`${SETTINGS_GROUP_ITEM_CLASS} flex flex-col gap-3 lg:flex-row lg:items-center`}
      data-testid={testId}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? <div className="text-xs leading-5 text-muted-foreground">{description}</div> : null}
      </div>
      <div className={`w-full min-w-0 lg:shrink-0 ${controlWidthClass(controlWidth)}`}>{children}</div>
    </div>
  )
}

export function SelectControl({
  value,
  onValueChange,
  options,
  testId,
  ariaLabel,
  autoFocus = false,
}: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  testId: string
  ariaLabel: string
  autoFocus?: boolean
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        className="w-full bg-transparent"
        aria-label={ariaLabel}
        data-testid={testId}
        data-value={value}
        data-settings-autofocus={autoFocus ? 'true' : undefined}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" data-anchor-strategy="popper">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function NumberInputControl({
  value,
  onValueChange,
  testId,
  ariaLabel,
  disabled = false,
}: {
  value: number
  onValueChange: (value: number) => void
  testId: string
  ariaLabel: string
  disabled?: boolean
}) {
  return (
    <Input
      id={testId}
      type="number"
      min={1}
      step={1}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onValueChange(sanitizePositiveInteger(Number(event.target.value), value))}
      data-testid={testId}
      className="w-full bg-transparent"
    />
  )
}

export function SettingsSwitchControl({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return <Switch checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled} />
}

export function LabeledSelect({
  label,
  value,
  onValueChange,
  options,
  testId,
  autoFocus = false,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  testId: string
  autoFocus?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)' }}>{label}</label>
      <SelectControl
        value={value}
        onValueChange={onValueChange}
        options={options}
        testId={testId}
        ariaLabel={label}
        autoFocus={autoFocus}
      />
    </div>
  )
}

export function LabeledNumberInput({
  label,
  value,
  onValueChange,
  testId,
  disabled = false,
}: {
  label: string
  value: number
  onValueChange: (value: number) => void
  testId: string
  disabled?: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--foreground)' }} htmlFor={testId}>{label}</label>
      <NumberInputControl
        value={value}
        onValueChange={onValueChange}
        testId={testId}
        ariaLabel={label}
        disabled={disabled}
      />
    </div>
  )
}

export function SettingsSwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  testId,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  testId?: string
}) {
  return (
    <label
      className={`${SETTINGS_GROUP_ITEM_CLASS} flex flex-col gap-3 lg:flex-row lg:items-center`}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      data-testid={testId}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
      <div className="flex justify-start lg:shrink-0 lg:justify-end">
        <SettingsSwitchControl label={label} checked={checked} onChange={onChange} disabled={disabled} />
      </div>
    </label>
  )
}
