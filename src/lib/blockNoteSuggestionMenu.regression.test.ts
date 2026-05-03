import { SuggestionMenu } from '@blocknote/core/extensions'
import { describe, expect, it, vi } from 'vitest'

type SuggestionPluginState = {
  triggerCharacter: string
  deleteTriggerCharacter: boolean
  queryStartPos: () => number
  query: string
  decorationId: string
  ignoreQueryLength?: boolean
}

type SuggestionEditorState = Record<string, SuggestionPluginState | undefined>

type SuggestionRoot = {
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => void
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ) => void
  querySelector: (selectors: string) => Element | null
}

type SuggestionEditorView = {
  root: SuggestionRoot
  state: SuggestionEditorState
}

type SuggestionPluginView = {
  emitUpdate: (triggerCharacter: string) => void
  update: (view: SuggestionEditorView, prevState: SuggestionEditorState) => void
}

type SuggestionMenuPlugin = {
  spec: {
    key: { key: string }
    view: (view: SuggestionEditorView) => SuggestionPluginView
  }
}

function createSuggestionPlugin() {
  const extensionFactory = SuggestionMenu() as unknown as (context: {
    editor: { isEditable: boolean }
  }) => { prosemirrorPlugins: SuggestionMenuPlugin[] }

  return extensionFactory({ editor: { isEditable: true } }).prosemirrorPlugins[0]
}

function createState(
  plugin: SuggestionMenuPlugin,
  pluginState?: SuggestionPluginState,
): SuggestionEditorState {
  return {
    [plugin.spec.key.key]: pluginState,
  }
}

function createPluginState(): SuggestionPluginState {
  return {
    triggerCharacter: '/',
    deleteTriggerCharacter: true,
    queryStartPos: () => 1,
    query: '',
    decorationId: 'missing-decoration',
  }
}

function createEditorView(state: SuggestionEditorState): SuggestionEditorView {
  return {
    root: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelector: vi.fn(() => null),
    },
    state,
  }
}

describe('patched BlockNote suggestion menu lifecycle', () => {
  it('ignores late updates before the suggestion menu state initializes', () => {
    const plugin = createSuggestionPlugin()
    const editorView = createEditorView(createState(plugin))
    const pluginView = plugin.spec.view(editorView)

    expect(() => pluginView.emitUpdate('/')).not.toThrow()
  })

  it('closes a suggestion menu before its decoration mounts without throwing', () => {
    const plugin = createSuggestionPlugin()
    const inactiveState = createState(plugin)
    const activeState = createState(plugin, createPluginState())
    const editorView = createEditorView(activeState)
    const pluginView = plugin.spec.view(editorView)

    expect(() => pluginView.update(editorView, inactiveState)).not.toThrow()

    editorView.state = inactiveState
    expect(() => pluginView.update(editorView, activeState)).not.toThrow()
  })
})
