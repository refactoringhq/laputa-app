import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { VaultEntry } from '../../types'
import { isTauri, mockInvoke } from '../../mock-tauri'

type NoteListSearchQuery = string
type NotePath = string
type VaultPath = string

interface SearchResultData {
  path: NotePath
}

interface SearchResponseData {
  results: SearchResultData[]
  elapsed_ms: number
}

interface SearchCommandArgs extends Record<string, unknown> {
  vaultPath: VaultPath
  query: NoteListSearchQuery
  mode: 'keyword'
  limit: number
  excludeFrontmatter: true
}

interface FullTextSearchRequest {
  limit: number
  query: NoteListSearchQuery
  vaultPaths: VaultPath[]
}

interface FullTextSearchState {
  loading: boolean
  query: NoteListSearchQuery
  resultPaths: Set<string>
}

const EMPTY_FULL_TEXT_SEARCH_STATE: FullTextSearchState = {
  loading: false,
  query: '',
  resultPaths: new Set(),
}

function normalizeFullTextQuery(query: NoteListSearchQuery): NoteListSearchQuery {
  return query.trim().toLowerCase()
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function normalizedDirectory(path: NotePath): VaultPath | null {
  const normalized = path.replaceAll('\\', '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return null
  return normalized.slice(0, index)
}

function commonDirectory(paths: NotePath[]): VaultPath | null {
  const directories = paths.map(normalizedDirectory).filter((path): path is string => !!path)
  if (directories.length === 0) return null

  const [first, ...rest] = directories.map((path) => path.split('/'))
  const common = [...first]
  for (const parts of rest) {
    trimCommonDirectoryPrefix({ common, parts })
  }

  const resolved = common.join('/')
  return resolved.length > 0 ? resolved : null
}

function trimCommonDirectoryPrefix({ common, parts }: { common: string[]; parts: string[] }): void {
  while (common.length > 0 && parts.slice(0, common.length).join('/') !== common.join('/')) {
    common.pop()
  }
}

function resolveNoteListSearchVaultPaths(entries: VaultEntry[]): VaultPath[] {
  const workspacePaths = unique(entries.map((entry) => entry.workspace?.path ?? ''))
  if (workspacePaths.length > 0) return workspacePaths

  const root = commonDirectory(entries.map((entry) => entry.path))
  return root ? [root] : []
}

function searchVault(args: SearchCommandArgs): Promise<SearchResponseData> {
  return isTauri()
    ? invoke<SearchResponseData>('search_vault', args)
    : mockInvoke<SearchResponseData>('search_vault', args)
}

function resolveResultPaths(responses: SearchResponseData[]): Set<string> {
  return new Set(unique(responses.flatMap((response) => response.results.map((result) => result.path))))
}

async function runFullTextSearch(request: FullTextSearchRequest): Promise<Set<string>> {
  const responses = await Promise.all(request.vaultPaths.map((vaultPath) => searchVault({
    vaultPath,
    query: request.query,
    mode: 'keyword',
    limit: request.limit,
    excludeFrontmatter: true,
  })))
  return resolveResultPaths(responses)
}

function createSearchRequest({ entries, query }: { entries: VaultEntry[]; query: NoteListSearchQuery }): FullTextSearchRequest | null {
  const vaultPaths = resolveNoteListSearchVaultPaths(entries)
  if (query.length === 0 || vaultPaths.length === 0) return null

  return {
    limit: Math.max(entries.length * 2, 50),
    query,
    vaultPaths,
  }
}

function useFullTextSearchRequest(entries: VaultEntry[], query: NoteListSearchQuery): FullTextSearchRequest | null {
  const normalizedQuery = normalizeFullTextQuery(query)
  return useMemo(() => createSearchRequest({ entries, query: normalizedQuery }), [entries, normalizedQuery])
}

export function useNoteListFullTextSearch(entries: VaultEntry[], query: NoteListSearchQuery): FullTextSearchState {
  const request = useFullTextSearchRequest(entries, query)
  const [state, setState] = useState<FullTextSearchState>(EMPTY_FULL_TEXT_SEARCH_STATE)

  useEffect(() => {
    if (!request) return

    let active = true
    void Promise.resolve().then(() => {
      if (active) setState({ loading: true, query: request.query, resultPaths: new Set() })
    })
    void runFullTextSearch(request).then((resultPaths) => {
      if (active) setState({ loading: false, query: request.query, resultPaths })
    }).catch(() => {
      if (active) setState({ loading: false, query: request.query, resultPaths: new Set() })
    })

    return () => {
      active = false
    }
  }, [request])

  if (!request) return EMPTY_FULL_TEXT_SEARCH_STATE
  if (state.query !== request.query) return { loading: true, query: request.query, resultPaths: new Set() }
  return state
}
