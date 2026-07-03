import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { isTauri, mockInvoke } from '../mock-tauri'
import type { createTranslator } from '../lib/i18n'
import {
  trackGitProviderChanged,
  trackGitProviderTested,
  trackGitWslDistroChanged,
} from '../lib/productAnalytics'
import type { GitProviderId, GitProviderProbe, GitProviderStatus } from '../types'
import { SelectControl, SettingsRow } from './SettingsControls'

type Translate = ReturnType<typeof createTranslator>
const DEFAULT_WSL_DISTRO_VALUE = '__default__'

const DEFAULT_PROVIDER_STATUS: GitProviderStatus = {
  selected_provider: 'native',
  selected_wsl_distro: null,
  native: {
    provider: 'native',
    label: 'Native Git',
    available: false,
    version: null,
    distro: null,
    path: null,
    message: '',
  },
  wsl_distributions: [],
}

interface GitProviderSettingsRowsProps {
  gitProvider: GitProviderId
  gitWslDistro: string | null
  setGitProvider: (value: GitProviderId) => void
  setGitWslDistro: (value: string | null) => void
  t: Translate
}

async function invokeGitProviderCommand<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (isTauri()) return invoke<T>(command, args)

  try {
    return await invoke<T>(command, args)
  } catch {
    return mockInvoke<T>(command, args)
  }
}

function providerOptions(t: Translate) {
  return [
    { value: 'native', label: t('settings.git.providerNative') },
    { value: 'wsl', label: t('settings.git.providerWsl') },
  ]
}

function wslProbeLabel(probe: GitProviderProbe): string {
  if (!probe.distro) return ''
  if (!probe.available) return `${probe.distro} · ${probe.message}`
  if (!probe.version) return probe.distro
  return `${probe.distro} · ${probe.version}`
}

function availableWslProbe(probe: GitProviderProbe): boolean {
  return Boolean(probe.available && probe.distro)
}

function firstAvailableWslDistro(status: GitProviderStatus): string | null {
  return status.wsl_distributions.find(availableWslProbe)?.distro ?? null
}

function wslDistroOptions({
  currentDistro,
  status,
  t,
}: {
  currentDistro: string | null
  status: GitProviderStatus
  t: Translate
}) {
  const options = [{ value: DEFAULT_WSL_DISTRO_VALUE, label: t('settings.git.wslDefaultDistro') }]
  const seen = new Set<string>()

  for (const probe of status.wsl_distributions) {
    if (!probe.distro || seen.has(probe.distro)) continue
    seen.add(probe.distro)
    options.push({ value: probe.distro, label: wslProbeLabel(probe) })
  }

  if (currentDistro && !seen.has(currentDistro)) {
    options.push({ value: currentDistro, label: currentDistro })
  }

  return options
}

function providerResultMessage(result: GitProviderProbe | null, t: Translate): string | null {
  if (!result) return null
  if (result.available) {
    return t('settings.git.providerTestOk', { version: result.version ?? result.message })
  }
  return t('settings.git.providerTestFailed', { message: result.message })
}

export function GitProviderSettingsRows({
  gitProvider,
  gitWslDistro,
  setGitProvider,
  setGitWslDistro,
  t,
}: GitProviderSettingsRowsProps) {
  const [providerStatus, setProviderStatus] = useState<GitProviderStatus>(DEFAULT_PROVIDER_STATUS)
  const [testingProvider, setTestingProvider] = useState(false)
  const [providerTestResult, setProviderTestResult] = useState<GitProviderProbe | null>(null)
  const distroOptions = useMemo(() => wslDistroOptions({
    currentDistro: gitWslDistro,
    status: providerStatus,
    t,
  }), [gitWslDistro, providerStatus, t])
  const providerTestMessage = providerResultMessage(providerTestResult, t)

  useEffect(() => {
    let cancelled = false
    invokeGitProviderCommand<GitProviderStatus>('git_provider_status', {})
      .then((status) => {
        if (!cancelled) setProviderStatus(status)
      })
      .catch(() => {
        if (!cancelled) setProviderStatus(DEFAULT_PROVIDER_STATUS)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (gitProvider !== 'wsl' || gitWslDistro) return
    const distro = firstAvailableWslDistro(providerStatus)
    if (distro) setGitWslDistro(distro)
  }, [gitProvider, gitWslDistro, providerStatus, setGitWslDistro])

  const handleProviderChange = (value: string) => {
    const nextProvider: GitProviderId = value === 'wsl' ? 'wsl' : 'native'
    if (nextProvider !== gitProvider) trackGitProviderChanged(nextProvider)
    setGitProvider(nextProvider)
    setProviderTestResult(null)
    if (nextProvider === 'native') setGitWslDistro(null)
  }

  const handleDistroChange = (value: string) => {
    const nextDistro = value === DEFAULT_WSL_DISTRO_VALUE ? null : value
    if (nextDistro !== gitWslDistro) trackGitWslDistroChanged(nextDistro !== null)
    setProviderTestResult(null)
    setGitWslDistro(nextDistro)
  }

  const handleTestProvider = async () => {
    setTestingProvider(true)
    setProviderTestResult(null)
    try {
      const result = await invokeGitProviderCommand<GitProviderProbe>('test_git_provider', {
        provider: gitProvider,
        distro: gitProvider === 'wsl' ? gitWslDistro : null,
        vaultPath: null,
      })
      setProviderTestResult(result)
      trackGitProviderTested(gitProvider, result.available)
    } catch (error) {
      setProviderTestResult({
        provider: gitProvider,
        label: gitProvider === 'wsl' ? t('settings.git.providerWsl') : t('settings.git.providerNative'),
        available: false,
        version: null,
        distro: gitProvider === 'wsl' ? gitWslDistro : null,
        path: null,
        message: error instanceof Error ? error.message : String(error),
      })
      trackGitProviderTested(gitProvider, false)
    } finally {
      setTestingProvider(false)
    }
  }

  return (
    <>
      <SettingsRow
        label={t('settings.git.provider')}
        description={t('settings.git.providerDescription')}
        controlWidth="default"
        testId="settings-git-provider-row"
      >
        <SelectControl
          value={gitProvider}
          onValueChange={handleProviderChange}
          options={providerOptions(t)}
          testId="settings-git-provider"
          ariaLabel={t('settings.git.provider')}
        />
      </SettingsRow>

      {gitProvider === 'wsl' ? (
        <SettingsRow
          label={t('settings.git.wslDistro')}
          description={t('settings.git.wslDistroDescription')}
          controlWidth="wide"
          testId="settings-git-wsl-distro-row"
        >
          <SelectControl
            value={gitWslDistro ?? DEFAULT_WSL_DISTRO_VALUE}
            onValueChange={handleDistroChange}
            options={distroOptions}
            testId="settings-git-wsl-distro"
            ariaLabel={t('settings.git.wslDistro')}
          />
        </SettingsRow>
      ) : null}

      <SettingsRow
        label={t('settings.git.providerTest')}
        description={providerTestMessage ?? t('settings.git.providerTestDescription')}
        controlWidth="compact"
        testId="settings-git-provider-test-row"
      >
        <Button
          type="button"
          variant="outline"
          onClick={handleTestProvider}
          disabled={testingProvider}
          data-testid="settings-git-provider-test"
          className="w-full"
        >
          {testingProvider ? t('settings.git.providerTesting') : t('settings.git.providerTest')}
        </Button>
      </SettingsRow>
    </>
  )
}
