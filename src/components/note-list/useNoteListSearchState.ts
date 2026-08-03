import { useCallback, useEffect, useRef, useState, useTransition } from 'react'

function normalizeSearch(search: string): string {
  return search.trim().toLowerCase()
}

export function useNoteListSearchState() {
  const [search, setSearch] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [isSearchPending, startSearchTransition] = useTransition()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const query = normalizeSearch(search)

  const updateSearch = useCallback((value: string) => {
    if (normalizeSearch(value).length === 0) {
      setSearch('')
      return
    }

    startSearchTransition(() => {
      setSearch(value)
    })
  }, [])

  useEffect(() => {
    if (!searchVisible) return

    const frameId = requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })

    return () => cancelAnimationFrame(frameId)
  }, [searchVisible])

  const clearSearch = useCallback(() => {
    setSearch('')
  }, [])

  const openSearch = useCallback(() => {
    setSearchVisible(true)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchVisible(false)
    clearSearch()
  }, [clearSearch])

  const toggleSearch = useCallback(() => {
    setSearchVisible((visible) => {
      if (visible) clearSearch()
      return !visible
    })
  }, [clearSearch])

  return {
    closeSearch,
    isSearching: isSearchPending,
    openSearch,
    query,
    search,
    searchInputRef,
    searchVisible,
    setSearch: updateSearch,
    toggleSearch,
  }
}
