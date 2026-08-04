import { useEffect, type Dispatch, type SetStateAction } from 'react'
import type { AppLocale } from '../lib/i18n'
import { translate } from '../lib/i18n'
import type { PulseCommit } from '../types'

interface InitialPulseLoadOptions {
  loadCommits: () => Promise<PulseCommit[]>
  locale: AppLocale
  pageSize: number
  refreshKey: number
  retryCount: number
  setCommits: Dispatch<SetStateAction<PulseCommit[]>>
  setError: Dispatch<SetStateAction<string | null>>
  setHasMore: Dispatch<SetStateAction<boolean>>
  setLoading: Dispatch<SetStateAction<boolean>>
  setSkip: Dispatch<SetStateAction<number>>
}

export function useInitialPulseLoad(options: InitialPulseLoadOptions): void {
  const { loadCommits, locale, pageSize, refreshKey, retryCount, setCommits, setError, setHasMore, setLoading, setSkip } = options
  useEffect(() => {
    void refreshKey
    void retryCount
    let active = true
    void Promise.resolve()
      .then(() => {
        if (!active) return null
        setLoading(true)
        setError(null)
        setCommits([])
        setSkip(0)
        setHasMore(true)
        return loadCommits()
      })
      .then((result) => {
        if (!active || result === null) return
        setCommits(result)
        setHasMore(result.length >= pageSize)
        setSkip(result.length)
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setError(typeof loadError === 'string' ? loadError : translate(locale, 'pulse.loadError'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [loadCommits, locale, pageSize, refreshKey, retryCount, setCommits, setError, setHasMore, setLoading, setSkip])
}
