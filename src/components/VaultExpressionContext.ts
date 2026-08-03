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
  vaultPath: string
}

interface VaultExpressionProviderProps extends VaultExpressionContextValue {
  children: ReactNode
}

interface ResolvedVaultExpressionTemplate {
  html: string
  unresolved: string[]
}

const VaultExpressionContext = createContext<VaultExpressionContextValue | null>(null)
const EMPTY_VAULT_EXPRESSION_CONTEXT: VaultExpressionContextValue = {
  currentContent: '',
  entries: [],
  locale: 'en-US',
  sourceEntry: null,
  vaultPath: '',
}

export function VaultExpressionProvider({
  children,
  currentContent,
  entries,
  locale,
  sourceEntry,
  vaultPath,
}: VaultExpressionProviderProps) {
  const value = useMemo(() => ({
    currentContent,
    entries,
    locale,
    sourceEntry,
    vaultPath,
  }), [currentContent, entries, locale, sourceEntry, vaultPath])

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
      Reflect.set(cachedContents, entry.path, content)
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
    const cachedContent = Reflect.get(cached, path) as string | undefined
    const currentContent = Reflect.get(current, path) as string | undefined
    if (cachedContent !== undefined) {
      Reflect.set(next, path, cachedContent)
    } else if (currentContent !== undefined) {
      Reflect.set(next, path, currentContent)
    }
  }
  return next
}

function sameContents(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Reflect.get(left, key) === Reflect.get(right, key))
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
  const expressionContext = context ?? EMPTY_VAULT_EXPRESSION_CONTEXT
  const compiled = useMemo(() => compileVaultExpressionTemplate(source), [source])
  const contentsByPath = useVaultExpressionDependencyContents(compiled, expressionContext)

  return useMemo(() => renderVaultExpressionTemplate({
    compiled,
    context: {
      contentsByPath,
      ...expressionContext,
    },
  }), [compiled, contentsByPath, expressionContext])
}
