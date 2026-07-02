import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/editorPerformanceTrace', () => ({
  logRichEditorDispatchTrace: vi.fn(),
}))

import { logRichEditorDispatchTrace } from '../utils/editorPerformanceTrace'
import { installRichEditorDispatchPerformanceProbe } from './richEditorDispatchPerformance'

describe('rich editor dispatch performance probe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('wraps ProseMirror dispatch once and logs the post-dispatch document size', () => {
    const nowSpy = vi.spyOn(performance, 'now')
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(16)
    const originalDispatch = vi.fn(() => {
      view.state.doc.content.size = 70_010
    })
    const view = {
      dispatch: originalDispatch,
      state: { doc: { content: { size: 70_000 } } },
    }
    const editor = { prosemirrorView: view }

    installRichEditorDispatchPerformanceProbe(editor as never, () => '/vault/large.md')
    const wrappedDispatch = view.dispatch
    installRichEditorDispatchPerformanceProbe(editor as never, () => '/vault/large.md')

    expect(view.dispatch).toBe(wrappedDispatch)

    view.dispatch({ docChanged: true, steps: [{}] })

    expect(originalDispatch).toHaveBeenCalledTimes(1)
    expect(logRichEditorDispatchTrace).toHaveBeenCalledWith({
      docChanged: true,
      docSize: 70_010,
      durationMs: 6,
      notePath: '/vault/large.md',
      stepCount: 1,
    })
    nowSpy.mockRestore()
  })

  it('ignores partial editor view mocks without a dispatch function', () => {
    const editor = { prosemirrorView: { state: { doc: { content: { size: 1 } } } } }

    expect(() => {
      installRichEditorDispatchPerformanceProbe(editor as never, () => '/vault/mock.md')
    }).not.toThrow()
    expect(logRichEditorDispatchTrace).not.toHaveBeenCalled()
  })
})
