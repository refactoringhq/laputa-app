import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { isTauri } from '../mock-tauri'
import {
  checkForAppUpdate,
  downloadAndInstallAppUpdate,
  type AppUpdateDownloadEvent,
  type AppUpdateMetadata,
} from '../lib/appUpdater'
import { openExternalUrl } from '../utils/url'

const RELEASE_NOTES_URL = 'https://refactoringhq.github.io/tolaria/'
const CALENDAR_VERSION_PATTERN = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(alpha|stable)\.(\d+))?$/

interface UpdateVersionInfo {
  version: string
  displayVersion: string
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | ({ state: 'available'; notes: string | undefined } & UpdateVersionInfo)
  | ({ state: 'downloading'; progress: number } & UpdateVersionInfo)
  | ({ state: 'ready' } & UpdateVersionInfo)
  | { state: 'error' }

export type UpdateCheckResult =
  | { kind: 'up-to-date' }
  | ({ kind: 'available' } & UpdateVersionInfo)
  | { kind: 'error'; message: string }

export interface UpdateActions {
  checkForUpdates: () => Promise<UpdateCheckResult>
  startDownload: () => void
  openReleaseNotes: () => void
  dismiss: () => void
}

function formatReleaseDisplayVersion(version: string): string {
  const normalizedVersion = version.trim()
  if (!normalizedVersion) return normalizedVersion

  const baseVersion = normalizedVersion.split('+')[0]
  const match = baseVersion.match(CALENDAR_VERSION_PATTERN)
  if (!match) return baseVersion

  const [, year, month, day, channel, sequence] = match
  const calendarVersion = `${Number(year)}.${Number(month)}.${Number(day)}`

  if (channel === 'alpha' && sequence) {
    return `Alpha ${calendarVersion}.${Number(sequence)}`
  }

  return calendarVersion
}

function createVersionInfo(version: string): UpdateVersionInfo {
  return {
    version,
    displayVersion: formatReleaseDisplayVersion(version),
  }
}

function buildUpdateCheckErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `Could not check for updates: ${error.message}`
  }
  if (typeof error === 'string' && error.trim()) {
    return `Could not check for updates: ${error}`
  }
  return 'Could not check for updates'
}

function toAvailableStatus(update: AppUpdateMetadata): UpdateStatus {
  return {
    state: 'available',
    ...createVersionInfo(update.version),
    notes: update.body ?? undefined,
  }
}

function createDownloadProgressHandler(
  versionInfo: UpdateVersionInfo,
  setStatus: Dispatch<SetStateAction<UpdateStatus>>,
): (event: AppUpdateDownloadEvent) => void {
  let totalBytes = 0
  let downloadedBytes = 0

  return (event) => {
    if (event.event === 'Started') {
      totalBytes = event.data.contentLength ?? 0
      return
    }

    if (event.event === 'Progress') {
      downloadedBytes += event.data.chunkLength
      const progress = totalBytes > 0 ? Math.min(downloadedBytes / totalBytes, 1) : 0
      setStatus({ state: 'downloading', ...versionInfo, progress })
      return
    }

    setStatus({ state: 'ready', ...versionInfo })
  }
}

export function useUpdater(
  releaseChannel: string | null | undefined,
): { status: UpdateStatus; actions: UpdateActions } {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const updateRef = useRef<AppUpdateMetadata | null>(null)

  const checkForUpdates = useCallback(async (): Promise<UpdateCheckResult> => {
    if (!isTauri()) return { kind: 'up-to-date' }

    setStatus({ state: 'checking' })

    try {
      const update = await checkForAppUpdate(releaseChannel)
      if (!update) {
        updateRef.current = null
        setStatus({ state: 'idle' })
        return { kind: 'up-to-date' }
      }

      const versionInfo = createVersionInfo(update.version)
      updateRef.current = update
      setStatus(toAvailableStatus(update))
      return { kind: 'available', ...versionInfo }
    } catch (error) {
      console.warn('[updater] Failed to check for updates')
      setStatus({ state: 'error' })
      return { kind: 'error', message: buildUpdateCheckErrorMessage(error) }
    }
  }, [releaseChannel])

  useEffect(() => {
    if (!isTauri()) return
    const timer = setTimeout(() => { checkForUpdates() }, 3000)
    return () => clearTimeout(timer)
  }, [checkForUpdates])

  const startDownload = useCallback(async () => {
    const update = updateRef.current
    if (!update) return

    const versionInfo = createVersionInfo(update.version)
    setStatus({ state: 'downloading', ...versionInfo, progress: 0 })

    try {
      await downloadAndInstallAppUpdate(
        releaseChannel,
        update.version,
        createDownloadProgressHandler(versionInfo, setStatus),
      )

      // If Finished wasn't emitted via callback, set ready after await resolves
      setStatus((prev) => (prev.state === 'downloading' ? { state: 'ready', ...versionInfo } : prev))
    } catch {
      console.warn('[updater] Download failed')
      setStatus({ state: 'error' })
    }
  }, [releaseChannel])

  const openReleaseNotes = useCallback(() => {
    openExternalUrl(RELEASE_NOTES_URL)
  }, [])

  const dismiss = useCallback(() => {
    updateRef.current = null
    setStatus({ state: 'idle' })
  }, [])

  return { status, actions: { checkForUpdates, startDownload, openReleaseNotes, dismiss } }
}

/**
 * Trigger app restart after an update has been downloaded.
 * Separated so the component can call it on button click.
 */
export async function restartApp(): Promise<void> {
  try {
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch {
    console.warn('[updater] Failed to relaunch')
  }
}
