import { useCallback, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useSheetWikilinkNavigation } from '../../hooks/useSheetWikilinkNavigation'
import type { AppLocale } from '../../lib/i18n'
import { buildRawEditorBaseItems } from '../../utils/rawEditorUtils'
import {
  type SheetContextMenuState,
} from '../../utils/sheetContextMenuState'
import {
  SHEET_INDEX,
} from '../../utils/sheetWorkbook'
import { buildTypeEntryMap } from '../../utils/typeColors'
import type { VaultEntry } from '../../types'
import {
  sheetCellFromPointer,
  type FormulaAutocompleteState,
  type SheetWikilinkAutocompleteState,
} from './sheetEditorHelpers'
import { useSheetCellInputCommit } from './useSheetCellInputCommit'
import { useSheetClipboardActions } from './useSheetClipboardActions'
import { useSheetContextMenuActions } from './useSheetContextMenuActions'
import { useSheetContextMenuCapture } from './useSheetContextMenuCapture'
import { useSheetExternalFormulaResolution } from './useSheetExternalFormulaResolution'
import { useGuardedWorkbookFocus } from './useGuardedWorkbookFocus'
import { useSheetInputActivityHandlers } from './useSheetInputActivityHandlers'
import { useSheetInlineAutocompletes } from './useSheetInlineAutocompletes'
import { useSheetKeyboardFocus } from './useSheetKeyboardFocus'
import { useSheetKeyboardHandlers } from './useSheetKeyboardHandlers'
import { useSheetKeyboardReleaseOutside } from './useSheetKeyboardReleaseOutside'
import { useSheetPointerCoordinatePatching } from './useSheetPointerCoordinatePatching'
import { useSheetPointerHandlers } from './useSheetPointerHandlers'
import { useSheetSelectionChrome } from './useSheetSelectionChrome'
import { useSheetWorkbookController } from './useSheetWorkbookController'

interface SheetEditorControllerOptions {
  content: string
  entries: VaultEntry[]
  flushContentRef?: MutableRefObject<((path: string) => void) | null>
  locale: AppLocale
  onContentChange: (path: string, content: string) => void
  onNavigateWikilink?: (target: string) => void
  path: string
  sourceEntry: VaultEntry | null
  vaultPath: string
}

function useSheetEditorState(entries: VaultEntry[]) {
  const [formulaAutocomplete, setFormulaAutocomplete] = useState<FormulaAutocompleteState | null>(null)
  const [wikilinkAutocomplete, setWikilinkAutocomplete] = useState<SheetWikilinkAutocompleteState | null>(null)
  const [sheetContextMenu, setSheetContextMenu] = useState<SheetContextMenuState | null>(null)
  const formulaInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const wikilinkInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const pendingExternalFormulaCommitRef = useRef(0)
  const sheetElementRef = useRef<HTMLDivElement | null>(null)
  const typeEntryMap = useMemo(() => buildTypeEntryMap(entries), [entries])
  const wikilinkBaseItems = useMemo(() => buildRawEditorBaseItems(entries), [entries])

  return {
    formulaAutocomplete,
    formulaInputRef,
    pendingExternalFormulaCommitRef,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetContextMenu,
    sheetElementRef,
    typeEntryMap,
    wikilinkAutocomplete,
    wikilinkBaseItems,
    wikilinkInputRef,
  }
}

type SheetEditorState = ReturnType<typeof useSheetEditorState>

function useSheetEditorWorkbookRuntime({
  content,
  entries,
  onContentChange,
  path,
  sourceEntry,
  pendingExternalFormulaCommitRef,
  sheetElementRef,
}: Pick<SheetEditorControllerOptions, 'content' | 'entries' | 'onContentChange' | 'path' | 'sourceEntry'> &
  Pick<SheetEditorState, 'pendingExternalFormulaCommitRef' | 'sheetElementRef'>) {
  const {
    buildLiveExternalFormulaContext,
    externalFormulaContextForBuild,
    nativeExternalFormulaInputsForBuild,
    shouldWaitForInitialExternalFormulaResolution,
  } = useSheetExternalFormulaResolution({
    content,
    entries,
    path,
    sourceEntry,
  })

  const workbookRuntime = useSheetWorkbookController({
    content,
    externalFormulaContextForBuild,
    nativeExternalFormulaInputsForBuild,
    onContentChange,
    path,
    pendingExternalFormulaCommitRef,
    shouldWaitForInitialExternalFormulaResolution,
  })
  const scheduleSelectionChromePatch = useSheetSelectionChrome({
    refreshWorkbook: workbookRuntime.refreshWorkbook,
    sheetElementRef,
    workbook: workbookRuntime.workbook,
  })
  const sheetPointerActiveRef = useSheetPointerCoordinatePatching({ sheetElementRef })

  return {
    ...workbookRuntime,
    buildLiveExternalFormulaContext,
    scheduleSelectionChromePatch,
    sheetPointerActiveRef,
  }
}

type SheetEditorWorkbookRuntime = ReturnType<typeof useSheetEditorWorkbookRuntime>

function useSheetEditorKeyboardRuntime({
  scheduleSelectionChromePatch,
  setFormulaAutocomplete,
  setSheetContextMenu,
  setWikilinkAutocomplete,
  sheetElementRef,
}: Pick<SheetEditorWorkbookRuntime, 'scheduleSelectionChromePatch'> &
  Pick<SheetEditorState,
    | 'setFormulaAutocomplete'
    | 'setSheetContextMenu'
    | 'setWikilinkAutocomplete'
    | 'sheetElementRef'
  >) {
  return useSheetKeyboardFocus({
    scheduleSelectionChromePatch,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
  })
}

type SheetEditorKeyboardRuntime = ReturnType<typeof useSheetEditorKeyboardRuntime>

function useSheetEditorContextRuntime({
  captureSheetKeyboard,
  refreshWorkbook,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  setSheetContextMenu,
  sheetElementRef,
  workbookRef,
}: Pick<SheetEditorKeyboardRuntime, 'captureSheetKeyboard'> &
  Pick<SheetEditorWorkbookRuntime, 'refreshWorkbook' | 'scheduleSelectionChromePatch' | 'scheduleSerialize' | 'workbookRef'> &
  Pick<SheetEditorState, 'setSheetContextMenu' | 'sheetElementRef'>) {
  const contextActions = useSheetContextMenuActions({
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setSheetContextMenu,
    workbookRef,
  })
  const handleContextMenuCapture = useSheetContextMenuCapture({
    captureSheetKeyboard,
    setSheetContextMenu,
    sheetElementRef,
    workbookRef,
  })

  return { ...contextActions, handleContextMenuCapture }
}

function useSheetEditorCommitRuntime({
  buildLiveExternalFormulaContext,
  cancelScheduledSerialize,
  flushContentRef,
  pendingExternalFormulaCommitRef,
  refreshWorkbook,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  serializeCurrentWorkbook,
  sheetElementRef,
  workbookRef,
}: Pick<SheetEditorControllerOptions, 'flushContentRef'> &
  Pick<SheetEditorState, 'pendingExternalFormulaCommitRef' | 'sheetElementRef'> &
  Pick<SheetEditorWorkbookRuntime,
    | 'buildLiveExternalFormulaContext'
    | 'cancelScheduledSerialize'
    | 'refreshWorkbook'
    | 'scheduleSelectionChromePatch'
    | 'scheduleSerialize'
    | 'serializeCurrentWorkbook'
    | 'workbookRef'
  >) {
  return useSheetCellInputCommit({
    buildLiveExternalFormulaContext,
    cancelScheduledSerialize,
    flushContentRef,
    pendingExternalFormulaCommitRef,
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    serializeCurrentWorkbook,
    sheetElementRef,
    workbookRef,
  })
}

type SheetEditorCommitRuntime = ReturnType<typeof useSheetEditorCommitRuntime>

function useSheetEditorClipboardRuntime({
  refreshWorkbook,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  setFormulaAutocomplete,
  setSheetContextMenu,
  setWikilinkAutocomplete,
  workbookRef,
  writeCellInputAt,
}: Pick<SheetEditorCommitRuntime, 'writeCellInputAt'> &
  Pick<SheetEditorWorkbookRuntime, 'refreshWorkbook' | 'scheduleSelectionChromePatch' | 'scheduleSerialize' | 'workbookRef'> &
  Pick<SheetEditorState, 'setFormulaAutocomplete' | 'setSheetContextMenu' | 'setWikilinkAutocomplete'>) {
  return useSheetClipboardActions({
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    workbookRef,
    writeCellInputAt,
  })
}

function useSheetEditorAutocompleteRuntime({
  commitSelectedCellInput,
  entries,
  formulaAutocomplete,
  formulaInputRef,
  locale,
  refreshWorkbook,
  scheduleSerialize,
  setFormulaAutocomplete,
  setWikilinkAutocomplete,
  sheetElementRef,
  sourceEntry,
  typeEntryMap,
  vaultPath,
  wikilinkAutocomplete,
  wikilinkBaseItems,
  wikilinkInputRef,
  workbookRef,
}: Pick<SheetEditorControllerOptions, 'entries' | 'locale' | 'sourceEntry' | 'vaultPath'> &
  Pick<SheetEditorCommitRuntime, 'commitSelectedCellInput'> &
  Pick<SheetEditorWorkbookRuntime, 'refreshWorkbook' | 'scheduleSerialize' | 'workbookRef'> &
  Pick<SheetEditorState,
    | 'formulaAutocomplete'
    | 'formulaInputRef'
    | 'setFormulaAutocomplete'
    | 'setWikilinkAutocomplete'
    | 'sheetElementRef'
    | 'typeEntryMap'
    | 'wikilinkAutocomplete'
    | 'wikilinkBaseItems'
    | 'wikilinkInputRef'
  >) {
  return useSheetInlineAutocompletes({
    commitSelectedCellInput,
    entries,
    formulaAutocomplete,
    formulaInputRef,
    locale,
    refreshWorkbook,
    scheduleSerialize,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
    sourceEntry,
    typeEntryMap,
    vaultPath,
    wikilinkAutocomplete,
    wikilinkBaseItems,
    wikilinkInputRef,
    workbookRef,
  })
}

type SheetEditorAutocompleteRuntime = ReturnType<typeof useSheetEditorAutocompleteRuntime>

function useSheetEditorKeyboardInputRuntime({
  cancelScheduledSerialize,
  captureSheetKeyboard,
  commitExternalFormulaEditorInput,
  handleFormulaKeyDown,
  handleWikilinkKeyDown,
  refreshWorkbook,
  releaseSheetKeyboard,
  restoreSheetKeyboardFocus,
  scheduleSelectionChromePatch,
  scheduleSerialize,
  serializeCurrentWorkbook,
  setFormulaAutocomplete,
  setSheetContextMenu,
  setWikilinkAutocomplete,
  sheetElementRef,
  sheetKeyboardCapturedRef,
  updateSheetInlineAutocompletes,
  workbookRef,
}: Pick<SheetEditorAutocompleteRuntime, 'handleFormulaKeyDown' | 'handleWikilinkKeyDown' | 'updateSheetInlineAutocompletes'> &
  Pick<SheetEditorCommitRuntime, 'commitExternalFormulaEditorInput'> &
  Pick<SheetEditorKeyboardRuntime, 'captureSheetKeyboard' | 'releaseSheetKeyboard' | 'restoreSheetKeyboardFocus' | 'sheetKeyboardCapturedRef'> &
  Pick<SheetEditorWorkbookRuntime,
    | 'cancelScheduledSerialize'
    | 'refreshWorkbook'
    | 'scheduleSelectionChromePatch'
    | 'scheduleSerialize'
    | 'serializeCurrentWorkbook'
    | 'workbookRef'
  > &
  Pick<SheetEditorState,
    | 'setFormulaAutocomplete'
    | 'setSheetContextMenu'
    | 'setWikilinkAutocomplete'
    | 'sheetElementRef'
  >) {
  const keyboardHandlers = useSheetKeyboardHandlers({
    cancelScheduledSerialize,
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    handleFormulaKeyDown,
    handleWikilinkKeyDown,
    refreshWorkbook,
    releaseSheetKeyboard,
    restoreSheetKeyboardFocus,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    serializeCurrentWorkbook,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
    sheetKeyboardCapturedRef,
    workbookRef,
  })
  const inputHandlers = useSheetInputActivityHandlers({
    commitExternalFormulaEditorInput,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
    updateSheetInlineAutocompletes,
    workbookRef,
  })

  useSheetKeyboardReleaseOutside({
    releaseSheetKeyboard,
    sheetElementRef,
  })

  return { ...keyboardHandlers, ...inputHandlers }
}

type SheetEditorKeyboardInputRuntime = ReturnType<typeof useSheetEditorKeyboardInputRuntime>

function useSheetEditorPointerRuntime({
  captureSheetKeyboard,
  commitExternalFormulaEditorInput,
  flushCurrentSheetContent,
  onNavigateWikilink,
  scheduleSelectionChromePatch,
  setFormulaAutocomplete,
  setSheetContextMenu,
  setWikilinkAutocomplete,
  sheetElementRef,
  sheetFocusRequestRef,
  sheetKeyboardCapturedRef,
  sheetPointerActiveRef,
  workbookRef,
}: Pick<SheetEditorControllerOptions, 'onNavigateWikilink'> &
  Pick<SheetEditorCommitRuntime, 'commitExternalFormulaEditorInput' | 'flushCurrentSheetContent'> &
  Pick<SheetEditorKeyboardRuntime, 'captureSheetKeyboard' | 'sheetFocusRequestRef' | 'sheetKeyboardCapturedRef'> &
  Pick<SheetEditorWorkbookRuntime, 'scheduleSelectionChromePatch' | 'sheetPointerActiveRef' | 'workbookRef'> &
  Pick<SheetEditorState, 'setFormulaAutocomplete' | 'setSheetContextMenu' | 'setWikilinkAutocomplete' | 'sheetElementRef'>) {
  const dismissSheetTransientUi = useCallback(() => {
    setFormulaAutocomplete(null)
    setWikilinkAutocomplete(null)
    setSheetContextMenu(null)
  }, [setFormulaAutocomplete, setSheetContextMenu, setWikilinkAutocomplete])
  const handleSheetWikilinkPointerDown = useSheetWikilinkNavigation({
    cellFromPointer: sheetCellFromPointer,
    containerRef: sheetElementRef,
    dismissTransientUi: dismissSheetTransientUi,
    onNavigateWikilink,
    onBeforeNavigate: flushCurrentSheetContent,
    sheetIndex: SHEET_INDEX,
    workbookRef,
  })

  return useSheetPointerHandlers({
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    handleSheetWikilinkPointerDown,
    scheduleSelectionChromePatch,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
    sheetFocusRequestRef,
    sheetKeyboardCapturedRef,
    sheetPointerActiveRef,
  })
}

type SheetEditorPointerRuntime = ReturnType<typeof useSheetEditorPointerRuntime>
type SheetEditorClipboardRuntime = ReturnType<typeof useSheetEditorClipboardRuntime>
type SheetEditorContextRuntime = ReturnType<typeof useSheetEditorContextRuntime>

function useSheetEditorInteractionHandlers({
  handleBlurCapture,
  handleContextMenuCapture,
  handleCopyCapture,
  handleCutCapture,
  handleInputCapture,
  handleKeyDownCapture,
  handleKeyUpCapture,
  handlePasteCapture,
  handlePointerDownCapture,
  handlePointerMoveCapture,
  handlePointerUpCapture,
  handleSheetKeyDown,
}: Pick<SheetEditorClipboardRuntime, 'handleCopyCapture' | 'handleCutCapture' | 'handlePasteCapture'> &
  Pick<SheetEditorContextRuntime, 'handleContextMenuCapture'> &
  Pick<SheetEditorKeyboardInputRuntime,
    | 'handleBlurCapture'
    | 'handleInputCapture'
    | 'handleKeyDownCapture'
    | 'handleKeyUpCapture'
    | 'handleSheetKeyDown'
  > &
  SheetEditorPointerRuntime) {
  return useMemo(() => ({
    onBlurCapture: handleBlurCapture,
    onCopyCapture: handleCopyCapture,
    onCutCapture: handleCutCapture,
    onContextMenuCapture: handleContextMenuCapture,
    onInputCapture: handleInputCapture,
    onKeyDown: handleSheetKeyDown,
    onKeyDownCapture: handleKeyDownCapture,
    onKeyUpCapture: handleKeyUpCapture,
    onPasteCapture: handlePasteCapture,
    onPointerDownCapture: handlePointerDownCapture,
    onPointerMoveCapture: handlePointerMoveCapture,
    onPointerUpCapture: handlePointerUpCapture,
  }), [
    handleBlurCapture,
    handleContextMenuCapture,
    handleCopyCapture,
    handleCutCapture,
    handleInputCapture,
    handleKeyDownCapture,
    handleKeyUpCapture,
    handlePasteCapture,
    handlePointerDownCapture,
    handlePointerMoveCapture,
    handlePointerUpCapture,
    handleSheetKeyDown,
  ])
}

export function useSheetEditorController(options: SheetEditorControllerOptions) {
  const state = useSheetEditorState(options.entries)
  const { setFormulaAutocomplete } = state
  const selectFormulaAutocompleteIndex = useCallback((index: number) => {
    setFormulaAutocomplete((current) => {
      if (!current) return null
      return { ...current, selectedIndex: index }
    })
  }, [setFormulaAutocomplete])
  const workbookRuntime = useSheetEditorWorkbookRuntime({ ...options, ...state })
  const keyboardRuntime = useSheetEditorKeyboardRuntime({ ...workbookRuntime, ...state })
  useGuardedWorkbookFocus({
    onWorkbookFocusBlocked: keyboardRuntime.releaseSheetKeyboard,
    sheetFocusSuppressedRef: keyboardRuntime.sheetFocusSuppressedRef,
    sheetElementRef: state.sheetElementRef,
    sheetKeyboardCapturedRef: keyboardRuntime.sheetKeyboardCapturedRef,
  })
  const contextRuntime = useSheetEditorContextRuntime({ ...keyboardRuntime, ...workbookRuntime, ...state })
  const commitRuntime = useSheetEditorCommitRuntime({ ...options, ...state, ...workbookRuntime })
  const clipboardRuntime = useSheetEditorClipboardRuntime({ ...state, ...workbookRuntime, ...commitRuntime })
  const autocompleteRuntime = useSheetEditorAutocompleteRuntime({ ...options, ...state, ...workbookRuntime, ...commitRuntime })
  const keyboardInputRuntime = useSheetEditorKeyboardInputRuntime({
    ...state,
    ...workbookRuntime,
    ...keyboardRuntime,
    ...commitRuntime,
    ...autocompleteRuntime,
  })
  const pointerRuntime = useSheetEditorPointerRuntime({
    ...options,
    ...state,
    ...workbookRuntime,
    ...keyboardRuntime,
    ...commitRuntime,
  })
  const interactionHandlers = useSheetEditorInteractionHandlers({
    ...clipboardRuntime,
    ...contextRuntime,
    ...keyboardInputRuntime,
    ...pointerRuntime,
  })

  return {
    ...state,
    ...workbookRuntime,
    ...contextRuntime,
    ...commitRuntime,
    ...autocompleteRuntime,
    interactionHandlers,
    selectFormulaAutocompleteIndex,
    sheetKeyboardActive: keyboardRuntime.sheetKeyboardActive,
  }
}
