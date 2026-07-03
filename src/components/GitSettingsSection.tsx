import type { createTranslator } from '../lib/i18n'
import type { GitProviderId } from '../types'
import { GitProviderSettingsRows } from './GitProviderSettingsRows'
import {
  NumberInputControl,
  SectionHeading,
  SettingsGroup,
  SettingsRow,
  SettingsSwitchRow,
} from './SettingsControls'

type Translate = ReturnType<typeof createTranslator>

interface GitSettingsSectionProps {
  autoGitEnabled: boolean
  autoGitIdleThresholdSeconds: number
  autoGitInactiveThresholdSeconds: number
  gitProvider: GitProviderId
  gitFeaturesEnabled: boolean
  gitWslDistro: string | null
  isGitVault: boolean
  setAutoGitEnabled: (value: boolean) => void
  setAutoGitIdleThresholdSeconds: (value: number) => void
  setAutoGitInactiveThresholdSeconds: (value: number) => void
  setGitFeaturesEnabled: (value: boolean) => void
  setGitProvider: (value: GitProviderId) => void
  setGitWslDistro: (value: string | null) => void
  t: Translate
}

function describeAutoGitAvailability(
  gitFeaturesEnabled: boolean,
  isGitVault: boolean,
  t: Translate,
): string {
  if (!gitFeaturesEnabled) return t('settings.autogit.description.gitDisabled')
  return isGitVault
    ? t('settings.autogit.description.enabled')
    : t('settings.autogit.description.disabled')
}

export function GitSettingsSection(props: GitSettingsSectionProps) {
  const {
    autoGitEnabled,
    autoGitIdleThresholdSeconds,
    autoGitInactiveThresholdSeconds,
    gitProvider,
    gitFeaturesEnabled,
    gitWslDistro,
    isGitVault,
    setAutoGitEnabled,
    setAutoGitIdleThresholdSeconds,
    setAutoGitInactiveThresholdSeconds,
    setGitFeaturesEnabled,
    setGitProvider,
    setGitWslDistro,
    t,
  } = props
  const gitControlsAvailable = gitFeaturesEnabled && isGitVault

  return (
    <>
      <SectionHeading title={t('settings.autogit.title')} />

      <SettingsGroup>
        <SettingsSwitchRow
          label={t('settings.git.enable')}
          description={t('settings.git.enableDescription')}
          checked={gitFeaturesEnabled}
          onChange={setGitFeaturesEnabled}
          testId="settings-git-enabled"
        />

        <GitProviderSettingsRows
          gitProvider={gitProvider}
          gitWslDistro={gitWslDistro}
          setGitProvider={setGitProvider}
          setGitWslDistro={setGitWslDistro}
          t={t}
        />

        <SettingsSwitchRow
          label={t('settings.autogit.enable')}
          description={gitControlsAvailable
            ? t('settings.autogit.enableDescription')
            : describeAutoGitAvailability(gitFeaturesEnabled, isGitVault, t)}
          checked={autoGitEnabled}
          onChange={setAutoGitEnabled}
          disabled={!gitControlsAvailable}
          testId="settings-autogit-enabled"
        />

        <SettingsRow
          label={t('settings.autogit.idleThreshold')}
          description={t('settings.autogit.idleThresholdDescription')}
          controlWidth="compact"
        >
          <NumberInputControl
            ariaLabel={t('settings.autogit.idleThreshold')}
            value={autoGitIdleThresholdSeconds}
            onValueChange={setAutoGitIdleThresholdSeconds}
            testId="settings-autogit-idle-threshold"
            disabled={!gitControlsAvailable}
          />
        </SettingsRow>

        <SettingsRow
          label={t('settings.autogit.inactiveThreshold')}
          description={t('settings.autogit.inactiveThresholdDescription')}
          controlWidth="compact"
        >
          <NumberInputControl
            ariaLabel={t('settings.autogit.inactiveThreshold')}
            value={autoGitInactiveThresholdSeconds}
            onValueChange={setAutoGitInactiveThresholdSeconds}
            testId="settings-autogit-inactive-threshold"
            disabled={!gitControlsAvailable}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}
