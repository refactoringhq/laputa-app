import { useState, useRef, useEffect, useCallback } from 'react'
import type { SearchResult } from '../types'
import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'
import { GITIGNORED_VISIBILITY_CHANGED_EVENT } from '../lib/gitignoredVisibilityEvents'

interface SearchResultData {
  title: string
  path: string
  snippet: string
  score: number
  note_type: string | null
}

interface SearchResponseData {
  results: SearchResultData[]
  elapsed_ms: number
}

const DEBOUNCE_MS = 300

function searchCall(args: Record<string, unknown>): Promise<SearchResponseData> {
  return isTauri()
    ? invoke<SearchResponseData>('search_vault', args)
    : mockInvoke<SearchResponseData>('search_vault', args)
}

function mapResults(raw: SearchResultData[]): SearchResult[] {
  const seen = new Set<string>()
  return raw
    .map(r => ({
      title: r.title,
      path: r.path,
      snippet: r.snippet,
      score: r.score,
      noteType: r.note_type,
    }))
    .filter(r => {
      if (seen.has(r.path)) return false
      if (r.noteType === 'Config') return false
      seen.add(r.path)
      return true
    })
}

function useGitignoredVisibilitySearchRefresh({
  active,
  performSearch,
  query,
}: {
  active: boolean
  performSearch: (query: string) => void
  query: string
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleGitignoredVisibilityChanged = () => {
      if (active && query.trim()) performSearch(query)
    }

    window.addEventListener(GITIGNORED_VISIBILITY_CHANGED_EVENT, handleGitignoredVisibilityChanged)
    return () => {
      window.removeEventListener(GITIGNORED_VISIBILITY_CHANGED_EVENT, handleGitignoredVisibilityChanged)
    }
  }, [active, performSearch, query])
}

export function useUnifiedSearch(vaultPath: string, active: boolean) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchGenRef = useRef(0)

  const reset = useCallback(() => {
    setQuery('')
    setResults([])
    setSelectedIndex(0)
    setElapsedMs(null)
    setLoading(false)
    searchGenRef.current++
  }, [])

  // On any active change: cancel inflight + debounce, then reset if opening
  useEffect(() => {
    searchGenRef.current++
    clearTimeout(debounceRef.current ?? undefined)
    debounceRef.current = null
    if (active) reset()
  }, [active, reset])

  const performSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setElapsedMs(null); setLoading(false); return }
    searchGenRef.current++
    const gen = searchGenRef.current
    setLoading(true)
    try {
      const response = await searchCall({ vaultPath, query: q, mode: 'keyword', limit: 20 })
      if (gen !== searchGenRef.current) return
      setResults(mapResults(response.results))
      setElapsedMs(response.elapsed_ms)
      setSelectedIndex(0)
    } catch {
      if (gen !== searchGenRef.current) return
    } finally {
      if (gen === searchGenRef.current) setLoading(false)
    }
  }, [vaultPath])

  useEffect(() => {
    clearTimeout(debounceRef.current ?? undefined)
    debounceRef.current = null
    if (!query.trim()) {
      setResults([])
      setElapsedMs(null)
      searchGenRef.current++
      setLoading(false)
      return
    }
    debounceRef.current = setTimeout(() => performSearch(query), DEBOUNCE_MS)
    return () => {
      clearTimeout(debounceRef.current ?? undefined)
      debounceRef.current = null
    }
  }, [query, performSearch])

  useGitignoredVisibilitySearchRefresh({
    active,
    performSearch: (nextQuery) => { void performSearch(nextQuery) },
    query,
  })

  return { query, setQuery, results, selectedIndex, setSelectedIndex, loading, elapsedMs }
}
