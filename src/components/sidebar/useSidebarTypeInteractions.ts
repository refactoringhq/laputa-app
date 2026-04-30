import { useCallback, useRef, useState } from 'react'
import type { VaultEntry } from '../../types'
import { applyCustomization, useOutsideClick } from './sidebarHooks'

interface SidebarTypeGroup {
  type: string
  label: string
}

interface SidebarTypeInteractionsInput {
  allSectionGroups: SidebarTypeGroup[]
  typeEntryMap: Record<string, VaultEntry>
  onCustomizeType?: (typeName: string, icon: string, color: string) => void
  onUpdateTypeTemplate?: (typeName: string, template: string) => void
  onRenameSection?: (typeName: string, label: string) => void
  onDeleteType?: (typeName: string) => void
}

function useSidebarTypeState() {
  const [customizeTarget, setCustomizeTarget] = useState<string | null>(null)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [contextMenuType, setContextMenuType] = useState<string | null>(null)
  const [renamingType, setRenamingType] = useState<string | null>(null)
  const [renameInitialValue, setRenameInitialValue] = useState('')
  const [showCustomize, setShowCustomize] = useState(false)

  const contextMenuRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const customizeRef = useRef<HTMLDivElement>(null)

  const closeContextMenu = useCallback(() => {
    setContextMenuPos(null)
    setContextMenuType(null)
  }, [])

  const closeCustomizeTarget = useCallback(() => setCustomizeTarget(null), [])
  const closeCustomize = useCallback(() => setShowCustomize(false), [])
  const cancelRename = useCallback(() => setRenamingType(null), [])

  useOutsideClick(customizeRef, showCustomize, closeCustomize)
  useOutsideClick(contextMenuRef, !!contextMenuPos, closeContextMenu)
  useOutsideClick(popoverRef, !!customizeTarget, closeCustomizeTarget)

  return {
    cancelRename,
    closeContextMenu,
    closeCustomizeTarget,
    contextMenuPos,
    contextMenuRef,
    contextMenuType,
    customizeRef,
    customizeTarget,
    popoverRef,
    renameInitialValue,
    renamingType,
    setContextMenuPos,
    setContextMenuType,
    setCustomizeTarget,
    setRenameInitialValue,
    setRenamingType,
    setShowCustomize,
    showCustomize,
  }
}

function useSidebarRenameCallbacks(params: {
  allSectionGroups: SidebarTypeGroup[]
  closeContextMenu: () => void
  onRenameSection?: (typeName: string, label: string) => void
  renamingType: string | null
  setRenameInitialValue: React.Dispatch<React.SetStateAction<string>>
  setRenamingType: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const {
    allSectionGroups,
    closeContextMenu,
    onRenameSection,
    renamingType,
    setRenameInitialValue,
    setRenamingType,
  } = params

  const handleStartRename = useCallback((type: string) => {
    closeContextMenu()
    const group = allSectionGroups.find((sectionGroup) => sectionGroup.type === type)
    setRenameInitialValue(group?.label ?? type)
    setRenamingType(type)
  }, [allSectionGroups, closeContextMenu, setRenameInitialValue, setRenamingType])

  const handleRenameSubmit = useCallback((value: string) => {
    if (renamingType) onRenameSection?.(renamingType, value)
    setRenamingType(null)
  }, [onRenameSection, renamingType, setRenamingType])

  return { handleRenameSubmit, handleStartRename }
}

export function useSidebarTypeInteractions({
  allSectionGroups,
  typeEntryMap,
  onCustomizeType,
  onUpdateTypeTemplate,
  onRenameSection,
  onDeleteType,
}: SidebarTypeInteractionsInput) {
  const state = useSidebarTypeState()
  const renameCallbacks = useSidebarRenameCallbacks({
    allSectionGroups,
    closeContextMenu: state.closeContextMenu,
    onRenameSection,
    renamingType: state.renamingType,
    setRenameInitialValue: state.setRenameInitialValue,
    setRenamingType: state.setRenamingType,
  })

  const handleContextMenu = useCallback((event: React.MouseEvent, type: string) => {
    event.preventDefault()
    event.stopPropagation()
    state.setContextMenuPos({ x: event.clientX, y: event.clientY })
    state.setContextMenuType(type)
  }, [state])

  const handleCustomize = useCallback((prop: 'icon' | 'color', value: string) => {
    applyCustomization(state.customizeTarget, typeEntryMap, onCustomizeType, prop, value)
  }, [onCustomizeType, state.customizeTarget, typeEntryMap])

  const handleChangeTemplate = useCallback((template: string) => {
    if (state.customizeTarget) onUpdateTypeTemplate?.(state.customizeTarget, template)
  }, [onUpdateTypeTemplate, state.customizeTarget])

  const openCustomizeTarget = useCallback((type: string) => {
    state.closeContextMenu()
    state.setCustomizeTarget(type)
  }, [state])

  const handleDeleteType = useCallback((type: string) => {
    state.closeContextMenu()
    onDeleteType?.(type)
  }, [onDeleteType, state])

  return {
    closeCustomizeTarget: state.closeCustomizeTarget,
    contextMenuPos: state.contextMenuPos,
    contextMenuRef: state.contextMenuRef,
    contextMenuType: state.contextMenuType,
    customizeRef: state.customizeRef,
    customizeTarget: state.customizeTarget,
    handleChangeTemplate,
    handleContextMenu,
    handleCustomize,
    handleDeleteType,
    handleRenameSubmit: renameCallbacks.handleRenameSubmit,
    handleStartRename: renameCallbacks.handleStartRename,
    openCustomizeTarget,
    popoverRef: state.popoverRef,
    cancelRename: state.cancelRename,
    renameInitialValue: state.renameInitialValue,
    renamingType: state.renamingType,
    setShowCustomize: state.setShowCustomize,
    showCustomize: state.showCustomize,
  }
}
