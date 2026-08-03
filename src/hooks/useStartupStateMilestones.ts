import { useEffect } from 'react'
import { markStartupPhase } from '../lib/startupPerformance'

interface StartupStateMilestonesOptions {
  isVaultContentLoading: boolean
  onboardingStatus: string
  settingsLoaded: boolean
  vaultListLoaded: boolean
}

function markReadyStateMilestones(options: StartupStateMilestonesOptions): void {
  if (options.settingsLoaded) markStartupPhase('settings_loaded')
  if (options.vaultListLoaded) markStartupPhase('vault_registry_loaded')
  if (options.onboardingStatus === 'ready') markStartupPhase('onboarding_ready')
}

export function useStartupStateMilestones(options: StartupStateMilestonesOptions): void {
  useEffect(() => { markReadyStateMilestones(options); }, [options])

  useEffect(() => {
    if (options.isVaultContentLoading || options.onboardingStatus !== 'ready') return

    let paintFrame = 0
    const commitFrame = requestAnimationFrame(() => {
      paintFrame = requestAnimationFrame(() => markStartupPhase('app_interactive'))
    })
    return () => {
      cancelAnimationFrame(commitFrame)
      cancelAnimationFrame(paintFrame)
    }
  }, [options.isVaultContentLoading, options.onboardingStatus])
}
