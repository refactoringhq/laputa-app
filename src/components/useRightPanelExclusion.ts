import { useCallback, useState } from 'react'
import { trackEvent } from '../lib/telemetry'

interface RightPanelExclusionOptions {
  inspectorCollapsed: boolean
  onToggleAIChat?: () => void
  onToggleInspector: () => void
  showAIChat?: boolean
}

interface RightPanelToggleOptions extends RightPanelExclusionOptions {
  closeTableOfContents: () => void
  openTableOfContents?: () => void
  showTableOfContents?: boolean
}

function prepareRightPanelOpen(
  panel: 'ai' | 'properties',
  {
    closeTableOfContents,
    inspectorCollapsed,
    onToggleAIChat,
    onToggleInspector,
    showAIChat,
  }: RightPanelToggleOptions,
) {
  if (panel === 'properties' && !inspectorCollapsed) return
  if (panel === 'ai' && showAIChat) return

  closeTableOfContents()
  if (panel === 'properties' && showAIChat) onToggleAIChat?.()
  if (panel === 'ai' && !inspectorCollapsed) onToggleInspector()
}

function toggleTableOfContentsPanel({
  closeTableOfContents,
  inspectorCollapsed,
  onToggleAIChat,
  onToggleInspector,
  openTableOfContents,
  showAIChat,
  showTableOfContents,
}: RightPanelToggleOptions) {
  if (showTableOfContents) {
    closeTableOfContents()
    return
  }

  if (!inspectorCollapsed) onToggleInspector()
  if (showAIChat) onToggleAIChat?.()
  openTableOfContents?.()
}

export function useRightPanelExclusion({
  inspectorCollapsed,
  onToggleAIChat,
  onToggleInspector,
  showAIChat,
}: RightPanelExclusionOptions) {
  const [showTableOfContents, setShowTableOfContents] = useState(false)
  const closeTableOfContents = useCallback(() => setShowTableOfContents(false), [])

  const handleToggleInspectorPanel = useCallback(() => {
    prepareRightPanelOpen('properties', {
      closeTableOfContents,
      inspectorCollapsed,
      onToggleAIChat,
      onToggleInspector,
      showAIChat,
    })
    onToggleInspector()
  }, [closeTableOfContents, inspectorCollapsed, onToggleAIChat, onToggleInspector, showAIChat])

  const handleToggleAIChatPanel = useCallback(() => {
    prepareRightPanelOpen('ai', {
      closeTableOfContents,
      inspectorCollapsed,
      onToggleAIChat,
      onToggleInspector,
      showAIChat,
    })
    onToggleAIChat?.()
  }, [closeTableOfContents, inspectorCollapsed, onToggleAIChat, onToggleInspector, showAIChat])

  const handleToggleTableOfContents = useCallback(() => {
    trackEvent('table_of_contents_toggled', { open: showTableOfContents ? 0 : 1 })
    toggleTableOfContentsPanel({
      closeTableOfContents,
      inspectorCollapsed,
      onToggleAIChat,
      onToggleInspector,
      openTableOfContents: () => setShowTableOfContents(true),
      showAIChat,
      showTableOfContents,
    })
  }, [closeTableOfContents, inspectorCollapsed, onToggleAIChat, onToggleInspector, showAIChat, showTableOfContents])

  return {
    handleToggleAIChatPanel,
    handleToggleInspectorPanel,
    handleToggleTableOfContents,
    showTableOfContents,
  }
}
