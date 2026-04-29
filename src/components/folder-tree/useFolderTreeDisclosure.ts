import { useCallback, useMemo, useState } from 'react'
import type { SidebarSelection } from '../../types'
import { ancestorTreePaths, expandedTreePaths, mergeExpandedPaths } from './folderTreeUtils'

interface UseFolderTreeDisclosureInput {
  collapsed?: boolean
  onToggle?: () => void
  renamingFolderPath?: string | null
  selection: SidebarSelection
}

function useExpandedFolders(selection: SidebarSelection, renamingFolderPath?: string | null) {
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>({})
  const requiredExpandedPaths = useMemo(() => {
    const nextPaths: string[] = []
    if (selection.kind === 'folder') nextPaths.push(...ancestorTreePaths(selection.path))
    if (renamingFolderPath) nextPaths.push(...expandedTreePaths(renamingFolderPath))
    return [...new Set(nextPaths)]
  }, [renamingFolderPath, selection])

  const expanded = useMemo(
    () => mergeExpandedPaths(manualExpanded, requiredExpandedPaths),
    [manualExpanded, requiredExpandedPaths],
  )

  const toggleFolder = useCallback((path: string) => {
    setManualExpanded((current) => {
      const defaultExpanded = path === ''
      return { ...current, [path]: !(current[path] ?? defaultExpanded) }
    })
  }, [])

  return {
    expanded,
    toggleFolder,
  }
}

function useFolderSectionState(
  externalCollapsed: boolean | undefined,
  onToggle: (() => void) | undefined,
  renamingFolderPath?: string | null,
) {
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const baseSectionCollapsed = externalCollapsed ?? internalCollapsed
  const sectionCollapsed = !isCreating && !renamingFolderPath && baseSectionCollapsed

  const handleToggleSection = useCallback(() => {
    if (onToggle) {
      onToggle()
      return
    }
    setInternalCollapsed((current) => !current)
  }, [onToggle])

  const openCreateForm = useCallback(() => {
    if (baseSectionCollapsed) {
      if (onToggle) onToggle()
      else setInternalCollapsed(false)
    }
    setIsCreating(true)
  }, [baseSectionCollapsed, onToggle])

  const closeCreateForm = useCallback(() => setIsCreating(false), [])

  return {
    handleToggleSection,
    isCreating,
    openCreateForm,
    sectionCollapsed,
    closeCreateForm,
  }
}

export function useFolderTreeDisclosure({
  collapsed: externalCollapsed,
  onToggle,
  renamingFolderPath,
  selection,
}: UseFolderTreeDisclosureInput) {
  const { expanded, toggleFolder } = useExpandedFolders(selection, renamingFolderPath)
  const {
    closeCreateForm,
    handleToggleSection,
    isCreating,
    openCreateForm,
    sectionCollapsed,
  } = useFolderSectionState(externalCollapsed, onToggle, renamingFolderPath)

  return {
    closeCreateForm,
    expanded,
    handleToggleSection,
    isCreating,
    openCreateForm,
    sectionCollapsed,
    toggleFolder,
  }
}
