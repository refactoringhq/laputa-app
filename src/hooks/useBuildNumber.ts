import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'

function tauriCall<T>(cmd: string): Promise<T> {
  return isTauri() ? invoke<T>(cmd) : mockInvoke<T>(cmd)
}

export function useBuildNumber(): string | undefined {
  const [buildNumber, setBuildNumber] = useState<string>()

  useEffect(() => {
    let mounted = true

    tauriCall<string>('get_build_number')
      .then((value) => {
        if (mounted) setBuildNumber(value)
      })
      .catch(() => {
        if (mounted) setBuildNumber('b?')
      })

    return () => {
      mounted = false
    }
  }, [])

  return buildNumber
}
