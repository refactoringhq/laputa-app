import type { useCreateBlockNote } from '@blocknote/react'
import type { MutableRefObject } from 'react'
import { failNoteOpenTrace } from '../utils/noteOpenPerformance'
import {
  applyBlocksToEditorProgressively,
  type EditorContentPathRef,
} from './editorContentSwapApply'
import {
  resolveBlocksForTarget,
  type CachedTabState,
} from './editorBlockResolution'
import {
  shouldAbortSwap,
  type SwapToken,
} from './editorSwapToken'

interface Tab {
  entry: { path: string }
  content: string
}

export function scheduleParsedBlockSwap(options: {
  editor: ReturnType<typeof useCreateBlockNote>
  cache: Map<string, CachedTabState>
  targetPath: string
  content: string
  prevActivePathRef: MutableRefObject<string | null>
  suppressChangeRef: MutableRefObject<boolean>
  editorContentPathRef: EditorContentPathRef
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  token: SwapToken
  signalTabSwap: (options: { path: string }) => void
  vaultPath?: string
}) {
  const {
    editor,
    cache,
    targetPath,
    content,
    prevActivePathRef,
    suppressChangeRef,
    editorContentPathRef,
    swapSeqRef,
    tabsRef,
    token,
    signalTabSwap,
    vaultPath,
  } = options

  const shouldAbort = () => shouldAbortSwap({ prevActivePathRef, suppressChangeRef, swapSeqRef, tabsRef, token })
  void resolveBlocksForTarget({ editor, cache, targetPath, content, vaultPath })
    .then(async ({ blocks, scrollTop }) => {
      if (shouldAbort()) return
      const applied = await applyBlocksToEditorProgressively({
        editor,
        blocks,
        scrollTop,
        suppressChangeRef,
        editorContentPathRef,
        targetPath,
        shouldAbort,
      })
      if (!applied || shouldAbort()) return
      signalTabSwap({ path: targetPath })
    })
    .catch((err: unknown) => {
      if (swapSeqRef.current === token.seq) suppressChangeRef.current = false
      console.error('Failed to parse/swap editor content:', err)
      failNoteOpenTrace(targetPath, 'parsed-swap-failed')
    })
}
