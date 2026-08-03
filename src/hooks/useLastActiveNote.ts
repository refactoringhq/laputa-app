import { useEffect, useRef, useState } from 'react'
import { APP_STORAGE_KEYS } from '../constants/appStorage'
import type { VaultEntry } from '../types'
import { notePathsMatch } from '../utils/notePathIdentity'
import { markStartupPhase } from '../lib/startupPerformance'

interface LastActiveNoteOptions {
  activeTabPath: string | null
  enabled: boolean
  entries: VaultEntry[]
  isVaultLoading: boolean
  openNote: (entry: VaultEntry) => Promise<void>
}

type CompleteRestoration = () => void

function loadLastActiveNotePath(): string | null {
  try {
    return localStorage.getItem(APP_STORAGE_KEYS.lastActiveNotePath)
  } catch {
    return null
  }
}

function saveLastActiveNotePath(path: string | null): void {
  try {
    if (path) {
      localStorage.setItem(APP_STORAGE_KEYS.lastActiveNotePath, path)
    } else {
      localStorage.removeItem(APP_STORAGE_KEYS.lastActiveNotePath)
    }
  } catch {
    // Ignore unavailable or restricted localStorage implementations.
  }
}

function restoreLastActiveNote(
  options: Pick<LastActiveNoteOptions, 'activeTabPath' | 'entries' | 'openNote'>,
  complete: CompleteRestoration,
): void {
  if (options.activeTabPath) {
    complete()
    return
  }

  const storedPath = loadLastActiveNotePath()
  const storedEntry = storedPath
    ? options.entries.find((entry) => notePathsMatch(entry.path, storedPath))
    : undefined
  if (!storedEntry) {
    if (storedPath) saveLastActiveNotePath(null)
    complete()
    return
  }

  markStartupPhase('last_active_note_restore_started')
  void options.openNote(storedEntry).then(() => {
    markStartupPhase('last_active_note_restored')
    complete()
  }, () => {
    saveLastActiveNotePath(null)
    complete()
  })
}

export function useLastActiveNote({
  activeTabPath,
  enabled,
  entries,
  isVaultLoading,
  openNote,
}: LastActiveNoteOptions): void {
  const restoreAttemptedRef = useRef(!enabled)
  const [restorationComplete, setRestorationComplete] = useState(!enabled)

  useEffect(() => {
    if (!enabled || isVaultLoading || restoreAttemptedRef.current) return

    const timer = window.setTimeout(() => {
      restoreAttemptedRef.current = true
      restoreLastActiveNote(
        { activeTabPath, entries, openNote },
        () => { setRestorationComplete(true); },
      )
    }, 0)

    return () => { window.clearTimeout(timer); }
  }, [activeTabPath, enabled, entries, isVaultLoading, openNote])

  useEffect(() => {
    if (!enabled || !restorationComplete) return
    saveLastActiveNotePath(activeTabPath)
  }, [activeTabPath, enabled, restorationComplete])
}
