import { useEffect } from 'react'
import type { AppLocale } from '../lib/i18n'
import type { VaultEntry } from '../types'
import { HiddenEditorMemoryProbe } from './HiddenEditorMemoryProbe'
import type { EditorMemoryProbeApi } from './editorMemoryProbeTypes'
import { useEditorMemoryProbeController } from './useEditorMemoryProbeController'

declare global {
  interface Window {
    __tolariaEditorMemoryProbe?: EditorMemoryProbeApi
  }
}

function useEditorMemoryProbeBridge(api: EditorMemoryProbeApi): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__tolariaEditorMemoryProbe = api
    return () => {
      if (window.__tolariaEditorMemoryProbe?.run === api.run) {
        delete window.__tolariaEditorMemoryProbe
      }
    }
  }, [api])
}

function useEditorMemoryProbeShortcut(runAndCopy: EditorMemoryProbeApi['runAndCopy']): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.altKey || !event.shiftKey || event.code !== 'KeyM') return
      event.preventDefault()
      event.stopPropagation()
      void runAndCopy()
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [runAndCopy])
}

export function EditorMemoryProbe({
  entries,
  locale,
  vaultPath,
}: {
  entries: VaultEntry[]
  locale?: AppLocale
  vaultPath?: string
}) {
  const controller = useEditorMemoryProbeController(entries)
  useEditorMemoryProbeBridge(controller)
  useEditorMemoryProbeShortcut(controller.runAndCopy)

  if (!import.meta.env.DEV || controller.targets.length === 0) return null

  return (
    <div
      aria-hidden="true"
      style={{
        height: 1,
        left: -100_000,
        opacity: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        position: 'fixed',
        top: 0,
        width: 1,
        zIndex: -1,
      }}
    >
      {controller.targets.map(target => (
        <HiddenEditorMemoryProbe
          key={target.entry.path}
          entries={entries}
          locale={locale}
          onReady={controller.handleReady}
          target={target}
          vaultPath={vaultPath}
        />
      ))}
    </div>
  )
}
