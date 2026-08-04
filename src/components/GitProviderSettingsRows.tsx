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

async function testSelectedProvider(
  provider: GitProviderId,
  distro: string | null,
  t: Translate,
) {
  try {
    return await invokeGitProviderCommand<GitProviderProbe>('test_git_provider', {
      provider,
      distro: provider === 'wsl' ? distro : null,
      vaultPath: null,
    })
  } catch (error) {
    return {
      provider,
      label: provider === 'wsl' ? t('settings.git.providerWsl') : t('settings.git.providerNative'),
      available: false,
      version: null,
      distro: provider === 'wsl' ? distro : null,
      path: null,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

interface GitProviderSelectionRowsProps {
  distroOptions: Array<{ label: string; value: string }>
  gitProvider: GitProviderId
  gitWslDistro: string | null
  onDistroChange: (value: string) => void
  onProviderChange: (value: string) => void
  t: Translate
}

function GitProviderSelectionRows({
  distroOptions,
  gitProvider,
  gitWslDistro,
  onDistroChange,
  onProviderChange,
  t,
}: GitProviderSelectionRowsProps) {
  return (
    <>
      <SettingsRow label={t('settings.git.provider')} description={t('settings.git.providerDescription')} controlWidth="default" testId="settings-git-provider-row">
        <SelectControl value={gitProvider} onValueChange={onProviderChange} options={providerOptions(t)} testId="settings-git-provider" ariaLabel={t('settings.git.provider')} />
      </SettingsRow>
      {gitProvider === 'wsl' ? (
        <SettingsRow label={t('settings.git.wslDistro')} description={t('settings.git.wslDistroDescription')} controlWidth="wide" testId="settings-git-wsl-distro-row">
          <SelectControl value={gitWslDistro ?? DEFAULT_WSL_DISTRO_VALUE} onValueChange={onDistroChange} options={distroOptions} testId="settings-git-wsl-distro" ariaLabel={t('settings.git.wslDistro')} />
        </SettingsRow>
      ) : null}
    </>
  )
}

function loadGitProviderStatus(setStatus: (status: GitProviderStatus) => void) {
  let cancelled = false
  invokeGitProviderCommand<GitProviderStatus>('git_provider_status', {})
    .then((status) => {
      if (!cancelled) setStatus(status)
    })
    .catch(() => {
      if (!cancelled) setStatus(DEFAULT_PROVIDER_STATUS)
    })
  return () => {
    cancelled = true
  }
}

function selectDefaultWslDistro(
  provider: GitProviderId,
  distro: string | null,
  status: GitProviderStatus,
  setDistro: (value: string | null) => void,
) {
  if (provider !== 'wsl' || distro) return
  const availableDistro = firstAvailableWslDistro(status)
  if (availableDistro) setDistro(availableDistro)
}

interface ChangeGitProviderOptions {
  clearResult: () => void
  currentProvider: GitProviderId
  setDistro: (value: string | null) => void
  setProvider: (value: GitProviderId) => void
  value: string
}

function changeGitProvider({
  clearResult,
  currentProvider,
  setDistro,
  setProvider,
  value,
}: ChangeGitProviderOptions) {
  const nextProvider: GitProviderId = value === 'wsl' ? 'wsl' : 'native'
  if (nextProvider !== currentProvider) trackGitProviderChanged(nextProvider)
  setProvider(nextProvider)
  clearResult()
  if (nextProvider === 'native') setDistro(null)
}

function changeWslDistro(
  value: string,
  currentDistro: string | null,
  setDistro: (value: string | null) => void,
  clearResult: () => void,
) {
  const nextDistro = value === DEFAULT_WSL_DISTRO_VALUE ? null : value
  if (nextDistro !== currentDistro) trackGitWslDistroChanged(nextDistro !== null)
  clearResult()
  setDistro(nextDistro)
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
  const clearProviderTestResult = () => setProviderTestResult(null)

  useEffect(() => loadGitProviderStatus(setProviderStatus), [])

  useEffect(() => {
    selectDefaultWslDistro(gitProvider, gitWslDistro, providerStatus, setGitWslDistro)
  }, [gitProvider, gitWslDistro, providerStatus, setGitWslDistro])

  const handleProviderChange = (value: string) => {
    changeGitProvider({
      clearResult: clearProviderTestResult,
      currentProvider: gitProvider,
      setDistro: setGitWslDistro,
      setProvider: setGitProvider,
      value,
    })
  }

  const handleDistroChange = (value: string) => {
    changeWslDistro(value, gitWslDistro, setGitWslDistro, clearProviderTestResult)
  }

  const handleTestProvider = async () => {
    setTestingProvider(true)
    setProviderTestResult(null)
    const result = await testSelectedProvider(gitProvider, gitWslDistro, t)
    setProviderTestResult(result)
    trackGitProviderTested(gitProvider, result.available)
    setTestingProvider(false)
  }

  return (
    <>
      <GitProviderSelectionRows
        distroOptions={distroOptions}
        gitProvider={gitProvider}
        gitWslDistro={gitWslDistro}
        onDistroChange={handleDistroChange}
        onProviderChange={handleProviderChange}
        t={t}
      />

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
