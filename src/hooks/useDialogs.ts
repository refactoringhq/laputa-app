import { useState, useCallback } from 'react'
import type { ViewDefinition } from '../types'

export function useDialogs() {
  const [showCreateTypeDialog, setShowCreateTypeDialog] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showAIChat, setShowAIChat] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCloneVault, setShowCloneVault] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showConflictResolver, setShowConflictResolver] = useState(false)
  const [showCreateViewDialog, setShowCreateViewDialog] = useState(false)
  const [editingView, setEditingView] = useState<{ filename: string; definition: ViewDefinition; rootPath?: string } | null>(null)

  const openCreateType = useCallback(() => setShowCreateTypeDialog(true), [])
  const closeCreateType = useCallback(() => setShowCreateTypeDialog(false), [])
  const openQuickOpen = useCallback(() => setShowQuickOpen(true), [])
  const closeQuickOpen = useCallback(() => setShowQuickOpen(false), [])
  const openCommandPalette = useCallback(() => setShowCommandPalette(true), [])
  const closeCommandPalette = useCallback(() => setShowCommandPalette(false), [])
  const openSettings = useCallback(() => setShowSettings(true), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])
  const openCloneVault = useCallback(() => setShowCloneVault(true), [])
  const closeCloneVault = useCallback(() => setShowCloneVault(false), [])
  const openAIChat = useCallback(() => setShowAIChat(true), [])
  const closeAIChat = useCallback(() => setShowAIChat(false), [])
  const toggleAIChat = useCallback(() => setShowAIChat((c) => !c), [])
  const openSearch = useCallback(() => setShowSearch(true), [])
  const closeSearch = useCallback(() => setShowSearch(false), [])
  const openConflictResolver = useCallback(() => setShowConflictResolver(true), [])
  const closeConflictResolver = useCallback(() => setShowConflictResolver(false), [])
  const openCreateView = useCallback(() => { setEditingView(null); setShowCreateViewDialog(true) }, [])
  const closeCreateView = useCallback(() => { setShowCreateViewDialog(false); setEditingView(null) }, [])
  const openEditView = useCallback((filename: string, definition: ViewDefinition, rootPath?: string) => {
    setEditingView({ filename, definition, rootPath })
    setShowCreateViewDialog(true)
  }, [])

  return {
    showCreateTypeDialog, openCreateType, closeCreateType,
    showQuickOpen, openQuickOpen, closeQuickOpen,
    showCommandPalette, openCommandPalette, closeCommandPalette,
    showAIChat, openAIChat, closeAIChat, toggleAIChat,
    showSettings, openSettings, closeSettings,
    showCloneVault, openCloneVault, closeCloneVault,
    showSearch, openSearch, closeSearch,
    showConflictResolver, openConflictResolver, closeConflictResolver,
    showCreateViewDialog, openCreateView, closeCreateView, editingView, openEditView,
  }
}
