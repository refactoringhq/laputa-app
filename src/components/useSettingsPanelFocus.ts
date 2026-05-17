import { useEffect, type RefObject } from 'react'

const hasFocusableTabIndex = (element: HTMLElement): boolean => element.tabIndex >= 0

const isAriaEnabled = (element: HTMLElement): boolean => element.getAttribute('aria-disabled') !== 'true'

const isNativeEnabled = (element: HTMLElement): boolean => element.getAttribute('disabled') === null

const getSettingsFocusableElements = (panel: HTMLElement): HTMLElement[] => {
  return Array.from(panel.querySelectorAll<HTMLElement>('*'))
    .filter(hasFocusableTabIndex)
    .filter(isAriaEnabled)
    .filter(isNativeEnabled)
}

const settingsBoundaryElement = (focusableElements: HTMLElement[], shiftKey: boolean): HTMLElement | undefined => {
  const targetIndex = shiftKey ? focusableElements.length - 1 : 0
  return focusableElements.at(targetIndex)
}

const isSettingsPanelElement = (panel: HTMLElement, activeElement: Element | null): activeElement is Element => {
  return activeElement instanceof Element
    && (panel.contains(activeElement) || activeElement.closest('[data-settings-panel-portal="true"]') !== null)
}

const isSettingsFocusBoundary = (activeElement: Element, focusableElements: HTMLElement[], shiftKey: boolean): boolean => {
  const boundaryIndex = shiftKey ? 0 : focusableElements.length - 1
  return activeElement === focusableElements.at(boundaryIndex)
}

const resolveSettingsFocusTarget = (panel: HTMLElement, shiftKey: boolean): HTMLElement | null => {
  const focusableElements = getSettingsFocusableElements(panel)
  if (focusableElements.length === 0) return panel

  const boundaryElement = settingsBoundaryElement(focusableElements, shiftKey)
  if (!boundaryElement) return null

  const activeElement = document.activeElement
  if (!isSettingsPanelElement(panel, activeElement)) return boundaryElement
  if (isSettingsFocusBoundary(activeElement, focusableElements, shiftKey)) return boundaryElement

  return null
}

const trapSettingsPanelFocus = (event: KeyboardEvent, panel: HTMLElement | null): void => {
  if (event.key !== 'Tab' || !panel) return

  const focusTarget = resolveSettingsFocusTarget(panel, event.shiftKey)
  if (!focusTarget) return

  event.preventDefault()
  focusTarget.focus()
}

export function useSettingsPanelAutofocus(panelRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const timer = setTimeout(() => {
      const focusTarget = panelRef.current?.querySelector<HTMLElement>('[data-settings-autofocus="true"]')
      focusTarget?.focus()
    }, 50)
    return () => clearTimeout(timer)
  }, [panelRef])
}

export function useSettingsPanelFocusTrap(panelRef: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      trapSettingsPanelFocus(event, panelRef.current)
    }

    document.addEventListener('keydown', handleDocumentKeyDown, true)
    return () => document.removeEventListener('keydown', handleDocumentKeyDown, true)
  }, [panelRef])
}
