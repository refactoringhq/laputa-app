import { useCallback, useEffect } from 'react'

interface UseAiPanelFocusArgs {
  inputRef: React.RefObject<HTMLDivElement | null>
  panelRef: React.RefObject<HTMLElement | null>
  hasMessages: boolean
  isActive: boolean
  onClose: () => void
}

function focusPreferredElement(
  panelRef: React.RefObject<HTMLElement | null>,
  inputRef: React.RefObject<HTMLDivElement | null>,
  shouldFocusPanel: boolean,
) {
  if (panelRef.current?.contains(document.activeElement)) return

  if (shouldFocusPanel) {
    panelRef.current?.focus()
    return
  }

  inputRef.current?.focus()
}

function shouldHandleEscape(
  event: KeyboardEvent,
  panelRef: React.RefObject<HTMLElement | null>,
): boolean {
  return event.key === 'Escape' && !!panelRef.current?.contains(document.activeElement)
}

export function useAiPanelFocus({
  inputRef,
  panelRef,
  hasMessages,
  isActive,
  onClose,
}: UseAiPanelFocusArgs) {
  const shouldFocusPanel = hasMessages || isActive

  useEffect(() => {
    const timer = setTimeout(() => {
      focusPreferredElement(panelRef, inputRef, shouldFocusPanel)
    }, 0)
    return () => clearTimeout(timer)
  }, [inputRef, panelRef, shouldFocusPanel])

  useEffect(() => {
    focusPreferredElement(panelRef, inputRef, shouldFocusPanel)
  }, [inputRef, panelRef, shouldFocusPanel])

  const handleEscape = useCallback((event: KeyboardEvent) => {
    if (!shouldHandleEscape(event, panelRef)) return

    event.preventDefault()
    onClose()
  }, [onClose, panelRef])

  useEffect(() => {
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [handleEscape])
}
