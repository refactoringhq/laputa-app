import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getCachedNoteContentEntry,
  hasResolvedCachedContent,
  prefetchNoteContent,
  subscribeNoteContentResolved,
} from '../../hooks/noteContentCache'
import type { VaultEntry } from '../../types'
import {
  canUseNativeSheetFormulaWorker,
  resolveExternalFormulaInputsWithNativeWorker,
  type SheetExternalFormulaInput,
  type SheetExternalFormulaWorkerDependency,
} from '../../utils/sheetExternalFormulaWorker'
import { shouldWaitForInitialSheetExternalFormulaResolution } from '../../utils/sheetInitialWorkbookReadiness'
import {
  MAX_EXTERNAL_FORMULA_DEPTH,
  resolveExternalSheetDependencyEntries,
  resolveExternalSheetEntriesForFormula,
  sheetExternalFormulaContext,
  sheetExternalFormulaWorkerSignature,
  sheetHasExternalFrontmatterReferences,
  sheetHasExternalFormulaReferences,
  sheetHasExternalLineReferences,
} from '../../utils/sheetWorkbook'

interface NativeExternalFormulaResolutionState {
  inputs: Map<string, SheetExternalFormulaInput>
  signature: string
  status: 'pending' | 'resolved' | 'unavailable'
}

interface UseSheetExternalFormulaResolutionOptions {
  content: string
  entries: VaultEntry[]
  path: string
  sourceEntry: VaultEntry | null
}

interface JsExternalFormulaResolverOptions {
  hasExternalFormulaReferences: boolean
  hasExternalFrontmatterReferences: boolean
  hasExternalLineReferences: boolean
  resolution: NativeExternalFormulaResolutionState | null
  signature: string
}

function retainResolvedDependencyContents(
  dependencyPaths: Set<string>,
  cachedContents: Record<string, string>,
  current: Record<string, string>,
) {
  const next: Record<string, string> = {}
  for (const path of dependencyPaths) {
    if (cachedContents[path] !== undefined) {
      next[path] = cachedContents[path]
    } else if (current[path] !== undefined) {
      next[path] = current[path]
    }
  }

  return Object.keys(next).length === Object.keys(current).length
    && Object.keys(next).every((path) => current[path] === next[path])
    ? current
    : next
}

function cacheResolvedDependencyContents(entries: VaultEntry[]) {
  const cachedContents: Record<string, string> = {}
  for (const entry of entries) {
    const cached = getCachedNoteContentEntry(entry.path)
    if (hasResolvedCachedContent(cached)) {
      cachedContents[entry.path] = cached.value
    } else {
      prefetchNoteContent(entry, { parsedBlockPreload: false })
    }
  }
  return cachedContents
}

function cachedContentValue(path: string) {
  const cached = getCachedNoteContentEntry(path)
  return hasResolvedCachedContent(cached) ? cached.value : undefined
}

function cachedDependencyEntries(
  options: UseSheetExternalFormulaResolutionOptions,
  cachedContents: Record<string, string>,
) {
  return resolveExternalSheetDependencyEntries({
    content: options.content,
    contentsByPath: new Map(Object.entries(cachedContents)),
    currentPath: options.path,
    entries: options.entries,
    sourceEntry: options.sourceEntry,
  })
}

function mergeCachedDependencyContents(
  cachedContents: Record<string, string>,
  sheetEntries: VaultEntry[],
) {
  let changed = false
  for (const entry of sheetEntries) {
    const content = cachedContentValue(entry.path)
    if (content !== undefined && cachedContents[entry.path] !== content) {
      cachedContents[entry.path] = content
      changed = true
    }
  }
  return changed
}

function initialExternalSheetContents(options: UseSheetExternalFormulaResolutionOptions) {
  const cachedContents: Record<string, string> = {}
  for (let depth = 0; depth <= MAX_EXTERNAL_FORMULA_DEPTH; depth += 1) {
    const changed = mergeCachedDependencyContents(
      cachedContents,
      cachedDependencyEntries(options, cachedContents),
    )
    if (!changed) return cachedContents
  }
  return cachedContents
}

function dependencyPathSet(pathKey: string) {
  return new Set(pathKey === '' ? [] : pathKey.split('\n'))
}

function deferStateUpdate(update: () => void) {
  queueMicrotask(update)
}

function canResolveNativeExternalFormulas(
  hasExternalFormulaReferences: boolean,
  hasExternalFrontmatterReferences: boolean,
  hasExternalLineReferences: boolean,
) {
  return hasExternalFormulaReferences
    && !hasExternalFrontmatterReferences
    && !hasExternalLineReferences
    && canUseNativeSheetFormulaWorker()
}

function nextPendingNativeResolution(
  current: NativeExternalFormulaResolutionState | null,
  signature: string,
) {
  if (current?.signature === signature && current.status === 'pending') return current
  return {
    inputs: current?.signature === signature ? current.inputs : new Map(),
    signature,
    status: 'pending' as const,
  }
}

function resolvedNativeResolution(
  signature: string,
  inputs: Map<string, SheetExternalFormulaInput> | null,
) {
  return {
    inputs: inputs ?? new Map(),
    signature,
    status: inputs ? 'resolved' as const : 'unavailable' as const,
  }
}

function resolvedNativeInputsForBuild(
  resolution: NativeExternalFormulaResolutionState | null,
  signature: string,
) {
  return resolution?.signature === signature && resolution.status === 'resolved'
    ? resolution.inputs
    : null
}

function shouldUseJsExternalFormulaResolver({
  hasExternalFormulaReferences,
  hasExternalFrontmatterReferences,
  hasExternalLineReferences,
  resolution,
  signature,
}: JsExternalFormulaResolverOptions) {
  return !hasExternalFormulaReferences
    || hasExternalFrontmatterReferences
    || hasExternalLineReferences
    || !canUseNativeSheetFormulaWorker()
    || (resolution?.signature === signature && resolution.status === 'unavailable')
}

function useExternalSheetContents({
  content,
  entries,
  path,
  sourceEntry,
}: UseSheetExternalFormulaResolutionOptions) {
  const [externalSheetContents, setExternalSheetContents] = useState<Record<string, string>>(
    () => initialExternalSheetContents({ content, entries, path, sourceEntry }),
  )
  const contentsByPath = useMemo(() => new Map(Object.entries(externalSheetContents)), [externalSheetContents])
  const sheetEntries = useMemo(() => resolveExternalSheetDependencyEntries({
    content,
    contentsByPath,
    currentPath: path,
    entries,
    sourceEntry,
  }), [content, contentsByPath, entries, path, sourceEntry])
  const pathKey = useMemo(() => sheetEntries.map((entry) => entry.path).sort().join('\n'), [sheetEntries])

  useEffect(() => {
    let subscribed = true
    const dependencyPaths = dependencyPathSet(pathKey)
    const cachedContents = cacheResolvedDependencyContents(sheetEntries)
    deferStateUpdate(() => {
      if (subscribed) setExternalSheetContents((current) => retainResolvedDependencyContents(dependencyPaths, cachedContents, current))
    })

    const unsubscribe = subscribeNoteContentResolved((event) => {
      if (!dependencyPaths.has(event.path)) return
      setExternalSheetContents((current) => (
        current[event.path] === event.content ? current : { ...current, [event.path]: event.content }
      ))
    })
    return () => {
      subscribed = false
      unsubscribe()
    }
  }, [pathKey, sheetEntries])

  const dependencies = useMemo<SheetExternalFormulaWorkerDependency[]>(
    () => sheetEntries.flatMap((entry) => {
      const dependencyContent = contentsByPath.get(entry.path)
      return dependencyContent === undefined ? [] : [{ content: dependencyContent, entry }]
    }),
    [contentsByPath, sheetEntries],
  )

  return { contentsByPath, dependencies, dependencyCount: sheetEntries.length }
}

function useNativeExternalFormulaResolution({
  content,
  dependencies,
  hasExternalFrontmatterReferences,
  hasExternalLineReferences,
  entries,
  hasExternalFormulaReferences,
  nativeSignature,
  path,
  sourceEntry,
}: UseSheetExternalFormulaResolutionOptions & {
  dependencies: SheetExternalFormulaWorkerDependency[]
  hasExternalFrontmatterReferences: boolean
  hasExternalFormulaReferences: boolean
  hasExternalLineReferences: boolean
  nativeSignature: string
}) {
  const [resolution, setResolution] = useState<NativeExternalFormulaResolutionState | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!canResolveNativeExternalFormulas(
      hasExternalFormulaReferences,
      hasExternalFrontmatterReferences,
      hasExternalLineReferences,
    )) {
      deferStateUpdate(() => {
        if (!cancelled) setResolution((current) => (current?.signature === nativeSignature ? null : current))
      })
      return () => {
        cancelled = true
      }
    }

    deferStateUpdate(() => {
      if (!cancelled) setResolution((current) => nextPendingNativeResolution(current, nativeSignature))
    })

    void resolveExternalFormulaInputsWithNativeWorker({
      content,
      currentPath: path,
      dependencies,
      entries,
      maxDepth: MAX_EXTERNAL_FORMULA_DEPTH,
      sourceEntry,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }).then((inputs) => {
      if (!cancelled) setResolution(resolvedNativeResolution(nativeSignature, inputs))
    })

    return () => {
      cancelled = true
    }
  }, [
    content,
    dependencies,
    entries,
    hasExternalFormulaReferences,
    hasExternalFrontmatterReferences,
    hasExternalLineReferences,
    nativeSignature,
    path,
    sourceEntry,
  ])

  return resolution
}

function useBuildLiveExternalFormulaContext({
  contentsByPath,
  entries,
  path,
  sourceEntry,
}: Pick<UseSheetExternalFormulaResolutionOptions, 'entries' | 'path' | 'sourceEntry'> & {
  contentsByPath: Map<string, string>
}) {
  return useCallback((formula: string) => {
    const liveContentsByPath = new Map(contentsByPath)
    const pendingLoads: Promise<unknown>[] = []
    for (const entry of resolveExternalSheetEntriesForFormula(formula, entries, sourceEntry, path)) {
      const cached = getCachedNoteContentEntry(entry.path)
      if (hasResolvedCachedContent(cached)) {
        liveContentsByPath.set(entry.path, cached.value)
        continue
      }

      prefetchNoteContent(entry, { parsedBlockPreload: false })
      const pending = getCachedNoteContentEntry(entry.path)
      if (pending) pendingLoads.push(pending.promise.catch(() => undefined))
    }

    return {
      context: sheetExternalFormulaContext({ contentsByPath: liveContentsByPath, currentPath: path, entries, sourceEntry }),
      pendingLoads,
    }
  }, [contentsByPath, entries, path, sourceEntry])
}

export function useSheetExternalFormulaResolution(options: UseSheetExternalFormulaResolutionOptions) {
  const { content, entries, path, sourceEntry } = options
  const { contentsByPath, dependencies, dependencyCount } = useExternalSheetContents(options)
  const hasExternalFormulaReferences = useMemo(() => sheetHasExternalFormulaReferences(content), [content])
  const hasExternalFrontmatterReferences = useMemo(() => (
    sheetHasExternalFrontmatterReferences(content)
    || dependencies.some((dependency) => sheetHasExternalFrontmatterReferences(dependency.content))
  ), [content, dependencies])
  const hasExternalLineReferences = useMemo(() => (
    sheetHasExternalLineReferences(content)
    || dependencies.some((dependency) => sheetHasExternalLineReferences(dependency.content))
  ), [content, dependencies])
  const nativeWorkerEnabled = canResolveNativeExternalFormulas(
    hasExternalFormulaReferences,
    hasExternalFrontmatterReferences,
    hasExternalLineReferences,
  )
  const nativeSignature = useMemo(() => sheetExternalFormulaWorkerSignature({
    content,
    dependencies,
    path,
  }), [content, dependencies, path])
  const nativeResolution = useNativeExternalFormulaResolution({
    ...options,
    dependencies,
    hasExternalFrontmatterReferences,
    hasExternalFormulaReferences,
    hasExternalLineReferences,
    nativeSignature,
  })
  const externalFormulaContext = useMemo(() => sheetExternalFormulaContext({
    contentsByPath,
    currentPath: path,
    entries,
    sourceEntry,
  }), [contentsByPath, entries, path, sourceEntry])
  const nativeExternalFormulaInputsForBuild = resolvedNativeInputsForBuild(nativeResolution, nativeSignature)
  const shouldUseJsResolver = shouldUseJsExternalFormulaResolver({
    hasExternalFormulaReferences,
    hasExternalFrontmatterReferences,
    hasExternalLineReferences,
    resolution: nativeResolution,
    signature: nativeSignature,
  })
  const shouldWaitForInitialExternalFormulaResolution = useCallback((workbookAlreadyBuilt: boolean) => (
    shouldWaitForInitialSheetExternalFormulaResolution({
      dependencyCount,
      hasExternalFormulaReferences,
      nativeWorkerEnabled,
      resolution: nativeResolution,
      resolvedDependencyCount: dependencies.length,
      signature: nativeSignature,
      workbookAlreadyBuilt,
    })
  ), [
    dependencies.length,
    dependencyCount,
    hasExternalFormulaReferences,
    nativeResolution,
    nativeSignature,
    nativeWorkerEnabled,
  ])

  return {
    buildLiveExternalFormulaContext: useBuildLiveExternalFormulaContext({ contentsByPath, entries, path, sourceEntry }),
    externalFormulaContextForBuild: shouldUseJsResolver ? externalFormulaContext : undefined,
    nativeExternalFormulaInputsForBuild,
    shouldWaitForInitialExternalFormulaResolution,
  }
}
