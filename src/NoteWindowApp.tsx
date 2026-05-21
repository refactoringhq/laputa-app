import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Editor } from './components/Editor'
import { Toast } from './components/Toast'
import { isTauri, mockInvoke } from './mock-tauri'
import type { NoteStatus, VaultEntry } from './types'
import {
  getNoteWindowPathCandidates,
  getNoteWindowParams,
  type NoteWindowParams,
} from './utils/windowMode'
import './App.css'

const NOTE_WINDOW_SAVE_DELAY_MS = 700
const MISSING_NOTE_WINDOW_PARAMS_MESSAGE = ''
const noop = () => {}

type NoteWindowLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; entry: VaultEntry; content: string }
  | { kind: 'error'; message: string }

type ReadyNoteWindowState = Extract<NoteWindowLoadState, { kind: 'ready' }>
type SaveRequest = { path: string; content: string; vaultPath: string }
type NoteWindowCommand =
  | 'get_note_content'
  | 'reload_vault_entry'
  | 'save_note_content'
  | 'sync_vault_asset_scope_for_window'

function tauriCall<T>(command: NoteWindowCommand, args: Record<string, unknown>): Promise<T> {
  return isTauri() ? invoke<T>(command, args) : mockInvoke<T>(command, args)
}

async function resolveNoteWindowEntry(params: NoteWindowParams): Promise<VaultEntry | null> {
  for (const path of getNoteWindowPathCandidates(params)) {
    try {
      const entry = await tauriCall<VaultEntry | null>('reload_vault_entry', {
        path,
        vaultPath: params.vaultPath,
      })
      if (entry) return entry
    } catch {
      // Keep trying normalized path candidates before surfacing a load failure.
    }
  }

  return null
}

async function loadNoteWindow(params: NoteWindowParams): Promise<Extract<NoteWindowLoadState, { kind: 'ready' }>> {
  await tauriCall('sync_vault_asset_scope_for_window', { vaultPath: params.vaultPath }).catch(() => undefined)
  const entry = await resolveNoteWindowEntry(params)
  if (!entry) throw new Error(`Could not open "${params.noteTitle}" in this window`)
  const content = await tauriCall<string>('get_note_content', {
    path: entry.path,
    vaultPath: params.vaultPath,
  })
  return { kind: 'ready', entry, content }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function initialNoteWindowState(params: NoteWindowParams | null): NoteWindowLoadState {
  return params ? { kind: 'loading' } : { kind: 'error', message: MISSING_NOTE_WINDOW_PARAMS_MESSAGE }
}

function useNoteWindowState(params: NoteWindowParams | null): NoteWindowLoadState {
  const [state, setState] = useState<NoteWindowLoadState>(() => initialNoteWindowState(params))

  useEffect(() => {
    if (!params) return
    let cancelled = false

    loadNoteWindow(params)
      .then((nextState) => {
        if (!cancelled) setState(nextState)
      })
      .catch((error) => {
        if (!cancelled) setState({ kind: 'error', message: errorMessage(error) })
      })

    return () => { cancelled = true }
  }, [params])

  return state
}

function getWindowTitle(state: NoteWindowLoadState, params: NoteWindowParams | null): string | null {
  return state.kind === 'ready' ? state.entry.title : params?.noteTitle ?? null
}

function useNoteWindowTitle(state: NoteWindowLoadState, params: NoteWindowParams | null): void {
  useEffect(() => {
    const title = getWindowTitle(state, params)
    if (!title) return

    document.title = title
    if (!isTauri()) return

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
      .catch((error) => console.warn('[window] Failed to update note window title:', error))
  }, [params, state])
}

function clearSaveTimer(saveTimerRef: MutableRefObject<number | null>): void {
  if (saveTimerRef.current === null) return

  window.clearTimeout(saveTimerRef.current)
  saveTimerRef.current = null
}

function saveNoteWindowContent(request: SaveRequest, setStatus: (status: NoteStatus) => void): void {
  setStatus('pendingSave')
  void tauriCall('save_note_content', request)
    .then(() => setStatus('clean'))
    .catch((error) => {
      console.warn('[window] Failed to save note window content:', error)
      setStatus('unsaved')
    })
}

function useDebouncedNoteWindowSave(vaultPath: string | null, setStatus: (status: NoteStatus) => void) {
  const saveTimerRef = useRef<number | null>(null)

  useEffect(() => () => clearSaveTimer(saveTimerRef), [])

  return useCallback((path: string, content: string) => {
    if (!vaultPath) return
    setStatus('unsaved')
    clearSaveTimer(saveTimerRef)

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      saveNoteWindowContent({ path, content, vaultPath }, setStatus)
    }, NOTE_WINDOW_SAVE_DELAY_MS)
  }, [setStatus, vaultPath])
}

function NoteWindowEditor({ params, state }: {
  params: NoteWindowParams
  state: ReadyNoteWindowState
}) {
  const [tabContent, setTabContent] = useState(state.content)
  const [noteStatus, setNoteStatus] = useState<NoteStatus>('clean')
  const saveContent = useDebouncedNoteWindowSave(params.vaultPath, setNoteStatus)
  const tab = useMemo(() => ({ entry: state.entry, content: tabContent }), [state.entry, tabContent])
  const updateContent = useCallback((path: string, content: string) => {
    setTabContent(content)
    saveContent(path, content)
  }, [saveContent])

  return (
    <Editor
      tabs={[tab]}
      activeTabPath={state.entry.path}
      entries={[state.entry]}
      onNavigateWikilink={noop}
      inspectorCollapsed
      onToggleInspector={noop}
      inspectorWidth={320}
      onInspectorResize={noop}
      inspectorEntry={state.entry}
      inspectorContent={tabContent}
      gitHistory={[]}
      onContentChange={updateContent}
      getNoteStatus={() => noteStatus}
      vaultPath={params.vaultPath}
      vaultPaths={[params.vaultPath]}
      locale="en"
    />
  )
}

export default function NoteWindowApp() {
  const params = useMemo(() => getNoteWindowParams(), [])
  const state = useNoteWindowState(params)
  useNoteWindowTitle(state, params)

  return (
    <div className="app-shell">
      <div className="app">
        <div className="app__editor">
          {state.kind === 'ready' && params ? (
            <NoteWindowEditor params={params} state={state} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {state.kind === 'error' ? state.message : null}
            </div>
          )}
        </div>
      </div>
      {state.kind === 'error' && <Toast message={state.message} onDismiss={noop} />}
    </div>
  )
}
