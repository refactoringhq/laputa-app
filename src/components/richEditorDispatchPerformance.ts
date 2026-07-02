import type { useCreateBlockNote } from '@blocknote/react'
import { logRichEditorDispatchTrace } from '../utils/editorPerformanceTrace'

type ProseMirrorTransactionLike = {
  docChanged?: boolean
  steps?: readonly unknown[]
}

type ProseMirrorDocLike = {
  content?: { size?: number }
  nodeSize?: number
}

type ProseMirrorViewLike = {
  dispatch: (transaction: ProseMirrorTransactionLike) => void
  state?: { doc?: ProseMirrorDocLike }
}

type EditorWithProseMirrorView = {
  prosemirrorView?: unknown
}

const instrumentedViews = new WeakSet<ProseMirrorViewLike>()

function isProseMirrorViewLike(view: unknown): view is ProseMirrorViewLike {
  return typeof view === 'object'
    && view !== null
    && typeof (view as { dispatch?: unknown }).dispatch === 'function'
}

function editorProseMirrorView(editor: ReturnType<typeof useCreateBlockNote>): ProseMirrorViewLike | undefined {
  const view = (editor as unknown as EditorWithProseMirrorView).prosemirrorView
  return isProseMirrorViewLike(view) ? view : undefined
}

function documentSize(view: ProseMirrorViewLike): number {
  return view.state?.doc?.content?.size ?? view.state?.doc?.nodeSize ?? 0
}

export function installRichEditorDispatchPerformanceProbe(
  editor: ReturnType<typeof useCreateBlockNote>,
  notePath: () => string | null | undefined,
) {
  const view = editorProseMirrorView(editor)
  if (!view || instrumentedViews.has(view)) return

  const originalDispatch = view.dispatch.bind(view)
  view.dispatch = (transaction) => {
    if (typeof performance === 'undefined') {
      originalDispatch(transaction)
      return
    }

    const startedAt = performance.now()
    try {
      originalDispatch(transaction)
    } finally {
      logRichEditorDispatchTrace({
        docChanged: transaction.docChanged === true,
        docSize: documentSize(view),
        durationMs: performance.now() - startedAt,
        notePath: notePath() ?? null,
        stepCount: transaction.steps?.length ?? 0,
      })
    }
  }
  instrumentedViews.add(view)
}
