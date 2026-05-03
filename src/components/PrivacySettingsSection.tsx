import type { createTranslator } from '../lib/i18n'
import { SectionHeading, SettingsGroup, SettingsGroupItem } from './SettingsControls'
import { Checkbox } from './ui/checkbox'

type Translate = ReturnType<typeof createTranslator>

interface PrivacySettingsSectionProps {
  t: Translate
  crashReporting: boolean
  setCrashReporting: (value: boolean) => void
  analytics: boolean
  setAnalytics: (value: boolean) => void
}

function isChecked(checked: boolean | 'indeterminate'): boolean {
  return checked === true
}

function TelemetryToggle({
  label,
  description,
  checked,
  onChange,
  testId,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
  testId: string
}) {
  return (
    <SettingsGroupItem testId={testId}>
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox checked={checked} onCheckedChange={(value) => onChange(isChecked(value))} className="mt-0.5" />
        <span className="space-y-1">
          <span className="block text-sm font-medium text-foreground">{label}</span>
          <span className="block text-xs leading-5 text-muted-foreground">{description}</span>
        </span>
      </label>
    </SettingsGroupItem>
  )
}

export function PrivacySettingsSection({
  t,
  crashReporting,
  setCrashReporting,
  analytics,
  setAnalytics,
}: PrivacySettingsSectionProps) {
  return (
    <>
      <SectionHeading title={t('settings.privacy.title')} />
      <SettingsGroup>
        <TelemetryToggle
          label={t('settings.privacy.crashReporting')}
          description={t('settings.privacy.crashReportingDescription')}
          checked={crashReporting}
          onChange={setCrashReporting}
          testId="settings-crash-reporting"
        />
        <TelemetryToggle
          label={t('settings.privacy.analytics')}
          description={t('settings.privacy.analyticsDescription')}
          checked={analytics}
          onChange={setAnalytics}
          testId="settings-analytics"
        />
      </SettingsGroup>
    </>
  )
}
