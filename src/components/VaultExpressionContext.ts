import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getCachedNoteContentEntry,
  hasResolvedCachedContent,
  prefetchNoteContent,
  subscribeNoteContentResolved,
} from '../hooks/noteContentCache'
import type { VaultEntry } from '../types'
import {
  compileVaultExpressionTemplate,
  renderVaultExpressionTemplate,
  vaultExpressionDependencySource,
  type CompiledVaultExpressionTemplate,
} from '../utils/vaultExpressions'
import { resolveExternalSheetDependencyEntries } from '../utils/sheetWorkbook'

interface VaultExpressionContextValue {
  currentContent: string
  entries: VaultEntry[]
  locale: string
  sourceEntry: VaultEntry | null
}

interface VaultExpressionProviderProps extends VaultExpressionContextValue {
  children: ReactNode
}

interface ResolvedVaultExpressionTemplate {
  html: string
  unresolved: string[]
}

const VaultExpressionContext = createContext<VaultExpressionContextValue | null>(null)

export function VaultExpressionProvider({
  children,
  currentContent,
  entries,
  locale,
  sourceEntry,
}: VaultExpressionProviderProps) {
  const value = useMemo(() => ({
    currentContent,
    entries,
    locale,
    sourceEntry,
  }), [currentContent, entries, locale, sourceEntry])

  return createElement(VaultExpressionContext.Provider, { value }, children)
}

function cachedContentForEntry(entry: VaultEntry): string | null {
  const cached = getCachedNoteContentEntry(entry.path)
  return hasResolvedCachedContent(cached) ? cached.value : null
}

function dependencyEntries({
  compiled,
  contentsByPath,
  context,
}: {
  compiled: CompiledVaultExpressionTemplate
  contentsByPath: Map<string, string>
  context: VaultExpressionContextValue
}): VaultEntry[] {
  const dependencySource = vaultExpressionDependencySource(compiled)
  if (dependencySource === '') return []

  return resolveExternalSheetDependencyEntries({
    content: dependencySource,
    contentsByPath,
    currentPath: context.sourceEntry?.path ?? '',
    entries: context.entries,
    sourceEntry: context.sourceEntry,
  })
}

function mergeCachedDependencyContents(entries: VaultEntry[]): Record<string, string> {
  const cachedContents: Record<string, string> = {}
  for (const entry of entries) {
    const content = cachedContentForEntry(entry)
    if (content === null) {
      prefetchNoteContent(entry, { parsedBlockPreload: false })
    } else {
      cachedContents[entry.path] = content
    }
  }
  return cachedContents
}

function retainDependencyContents(
  paths: Set<string>,
  cached: Record<string, string>,
  current: Record<string, string>,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const path of paths) {
    if (cached[path] !== undefined) {
      next[path] = cached[path]
    } else if (current[path] !== undefined) {
      next[path] = current[path]
    }
  }
  return next
}

function sameContents(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => left[key] === right[key])
}

function deferStateUpdate(update: () => void): void {
  queueMicrotask(update)
}

function useVaultExpressionDependencyContents(
  compiled: CompiledVaultExpressionTemplate,
  context: VaultExpressionContextValue,
): Map<string, string> {
  const [contents, setContents] = useState<Record<string, string>>({})
  const contentsByPath = useMemo(() => new Map(Object.entries(contents)), [contents])
  const entries = useMemo(() => dependencyEntries({ compiled, contentsByPath, context }), [compiled, contentsByPath, context])
  const pathKey = useMemo(() => entries.map((entry) => entry.path).sort().join('\n'), [entries])

  useEffect(() => {
    let subscribed = true
    const paths = new Set(pathKey === '' ? [] : pathKey.split('\n'))
    const cached = mergeCachedDependencyContents(entries)
    deferStateUpdate(() => {
      if (!subscribed) return
      setContents((current) => {
        const next = retainDependencyContents(paths, cached, current)
        return sameContents(current, next) ? current : next
      })
    })

    const unsubscribe = subscribeNoteContentResolved((event) => {
      if (!paths.has(event.path)) return
      setContents((current) => (
        current[event.path] === event.content ? current : { ...current, [event.path]: event.content }
      ))
    })
    return () => {
      subscribed = false
      unsubscribe()
    }
  }, [entries, pathKey])

  return contentsByPath
}

export function useResolvedVaultExpressionTemplate(source: string): ResolvedVaultExpressionTemplate {
  const context = useContext(VaultExpressionContext)
  const compiled = useMemo(() => compileVaultExpressionTemplate(source), [source])
  const contentsByPath = useVaultExpressionDependencyContents(compiled, context ?? {
    currentContent: '',
    entries: [],
    locale: 'en-US',
    sourceEntry: null,
  })

  return useMemo(() => renderVaultExpressionTemplate({
    compiled,
    context: {
      contentsByPath,
      currentContent: context?.currentContent ?? '',
      entries: context?.entries ?? [],
      locale: context?.locale ?? 'en-US',
      sourceEntry: context?.sourceEntry ?? null,
    },
  }), [compiled, contentsByPath, context])
}
