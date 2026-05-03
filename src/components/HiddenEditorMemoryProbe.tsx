import { useEffect } from 'react'
import { useCreateBlockNote } from '@blocknote/react'
import { uploadImageFile } from '../hooks/useImageDrop'
import { useEditorTabSwap } from '../hooks/useEditorTabSwap'
import { RUNTIME_STYLE_NONCE } from '../lib/runtimeStyleNonce'
import type { AppLocale } from '../lib/i18n'
import type { VaultEntry } from '../types'
import { createArrowLigaturesExtension } from './arrowLigaturesExtension'
import { createMathInputExtension } from './mathInputExtension'
import { schema } from './editorSchema'
import type { ProbeTarget } from './editorMemoryProbeTypes'
import { SingleEditorView } from './SingleEditorView'

function useProbeEditor(target: ProbeTarget, vaultPath?: string) {
  const editor = useCreateBlockNote({
    schema,
    uploadFile: (file: File) => uploadImageFile(file, vaultPath),
    _tiptapOptions: { injectNonce: RUNTIME_STYLE_NONCE },
    extensions: [createArrowLigaturesExtension(), createMathInputExtension()],
  })
  useEditorTabSwap({
    tabs: [{ entry: target.entry, content: target.content }],
    activeTabPath: target.entry.path,
    editor,
    rawMode: false,
    vaultPath,
  })
  return editor
}

function useProbeReadySignal(target: ProbeTarget, onReady: (path: string) => void): void {
  useEffect(() => {
    const handleSwap = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail
      if (detail?.path === target.entry.path) onReady(target.entry.path)
    }
    window.addEventListener('laputa:editor-tab-swapped', handleSwap)
    return () => window.removeEventListener('laputa:editor-tab-swapped', handleSwap)
  }, [onReady, target.entry.path])
}

export function HiddenEditorMemoryProbe({
  entries,
  locale,
  onReady,
  target,
  vaultPath,
}: {
  entries: VaultEntry[]
  locale?: AppLocale
  onReady: (path: string) => void
  target: ProbeTarget
  vaultPath?: string
}) {
  const editor = useProbeEditor(target, vaultPath)
  useProbeReadySignal(target, onReady)

  return (
    <div
      aria-hidden="true"
      data-editor-memory-probe-path={target.entry.path}
      style={{ height: 900, overflow: 'hidden', width: 900 }}
    >
      <SingleEditorView
        editor={editor}
        entries={entries}
        onNavigateWikilink={() => {}}
        editable={false}
        vaultPath={vaultPath}
        locale={locale}
      />
    </div>
  )
}
