import { useState, useCallback } from 'react'
import type { ViewDefinition } from '../types'

export function useDialogs() {
  const [showCreateTypeDialog, setShowCreateTypeDialog] = useState(false)
  const [showCreateNoteFromUrlDialog, setShowCreateNoteFromUrlDialog] = useState(false)
  const [showQuickOpen, setShowQuickOpen] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showAIChat, setShowAIChat] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCloneVault, setShowCloneVault] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showConflictResolver, setShowConflictResolver] = useState(false)
  const [showCreateViewDialog, setShowCreateViewDialog] = useState(false)
  const [editingView, setEditingView] = useState<{ filename: string; definition: ViewDefinition } | null>(null)

  const openCreateType = useCallback(() => setShowCreateTypeDialog(true), [])
  const closeCreateType = useCallback(() => setShowCreateTypeDialog(false), [])
  const openCreateNoteFromUrl = useCallback(() => setShowCreateNoteFromUrlDialog(true), [])
  const closeCreateNoteFromUrl = useCallback(() => setShowCreateNoteFromUrlDialog(false), [])
  const openQuickOpen = useCallback(() => setShowQuickOpen(true), [])
  const closeQuickOpen = useCallback(() => setShowQuickOpen(false), [])
  const openCommandPalette = useCallback(() => setShowCommandPalette(true), [])
  const closeCommandPalette = useCallback(() => setShowCommandPalette(false), [])
  const openSettings = useCallback(() => setShowSettings(true), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])
  const openCloneVault = useCallback(() => setShowCloneVault(true), [])
  const closeCloneVault = useCallback(() => setShowCloneVault(false), [])
  const toggleAIChat = useCallback(() => setShowAIChat((c) => !c), [])
  const openSearch = useCallback(() => setShowSearch(true), [])
  const closeSearch = useCallback(() => setShowSearch(false), [])
  const openConflictResolver = useCallback(() => setShowConflictResolver(true), [])
  const closeConflictResolver = useCallback(() => setShowConflictResolver(false), [])
  const openCreateView = useCallback(() => { setEditingView(null); setShowCreateViewDialog(true) }, [])
  const closeCreateView = useCallback(() => { setShowCreateViewDialog(false); setEditingView(null) }, [])
  const openEditView = useCallback((filename: string, definition: ViewDefinition) => {
    setEditingView({ filename, definition })
    setShowCreateViewDialog(true)
  }, [])

  return {
    showCreateTypeDialog, openCreateType, closeCreateType,
    showCreateNoteFromUrlDialog, openCreateNoteFromUrl, closeCreateNoteFromUrl,
    showQuickOpen, openQuickOpen, closeQuickOpen,
    showCommandPalette, openCommandPalette, closeCommandPalette,
    showAIChat, toggleAIChat,
    showSettings, openSettings, closeSettings,
    showCloneVault, openCloneVault, closeCloneVault,
    showSearch, openSearch, closeSearch,
    showConflictResolver, openConflictResolver, closeConflictResolver,
    showCreateViewDialog, openCreateView, closeCreateView, editingView, openEditView,
  }
}
