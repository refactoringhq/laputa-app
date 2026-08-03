import { useCallback, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useSheetWikilinkNavigation } from '../../hooks/useSheetWikilinkNavigation'
import type { AppLocale } from '../../lib/i18n'
import { buildRawEditorBaseItems } from '../../utils/rawEditorUtils'
import type { SheetContextMenuState } from '../../utils/sheetContextMenuState'
import { SHEET_INDEX } from '../../utils/sheetWorkbook'
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
import { isReleasedWorkbookModelError } from './sheetReleasedModel'
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

function useSheetEditorWorkbookRuntime(
  options: Pick<SheetEditorControllerOptions, 'content' | 'entries' | 'onContentChange' | 'path' | 'sourceEntry'> &
    Pick<SheetEditorState, 'pendingExternalFormulaCommitRef' | 'sheetElementRef'>,
) {
  const { content, entries, onContentChange, path, sourceEntry, pendingExternalFormulaCommitRef, sheetElementRef } =
    options
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
      const sheetPointerActiveRef = useSheetPointerCoordinatePatching({
        sheetElementRef,
      })

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
      Pick<
        SheetEditorState,
        'setFormulaAutocomplete' | 'setSheetContextMenu' | 'setWikilinkAutocomplete' | 'sheetElementRef'
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

    function useSheetEditorContextRuntime(
      options: Pick<SheetEditorKeyboardRuntime, 'captureSheetKeyboard'> &
        Pick<
          SheetEditorWorkbookRuntime,
          'refreshWorkbook' | 'scheduleSelectionChromePatch' | 'scheduleSerialize' | 'workbookRef'
        > &
        Pick<SheetEditorState, 'setSheetContextMenu' | 'sheetElementRef'>,
    ) {
      const {
      captureSheetKeyboard,
      refreshWorkbook,
      scheduleSelectionChromePatch,
      scheduleSerialize,
      setSheetContextMenu,
      sheetElementRef,
      workbookRef,
  } = options
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

function useSheetEditorCommitRuntime(
  options: Pick<SheetEditorControllerOptions, 'flushContentRef'> &
    Pick<SheetEditorState, 'pendingExternalFormulaCommitRef' | 'sheetElementRef'> &
    Pick<
      SheetEditorWorkbookRuntime,
      | 'buildLiveExternalFormulaContext'
      | 'cancelScheduledSerialize'
      | 'refreshWorkbook'
      | 'scheduleSelectionChromePatch'
      | 'scheduleSerialize'
      | 'serializeCurrentWorkbook'
      | 'workbookRef'
    >,
) {
  const {
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
  } = options
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

function useSheetEditorClipboardRuntime(
  options: Pick<SheetEditorCommitRuntime, 'writeCellInputAt'> &
    Pick<
      SheetEditorWorkbookRuntime,
      'refreshWorkbook' | 'scheduleSelectionChromePatch' | 'scheduleSerialize' | 'workbookRef'
    > &
    Pick<SheetEditorState, 'setFormulaAutocomplete' | 'setSheetContextMenu' | 'setWikilinkAutocomplete'>,
) {
  const {
    refreshWorkbook,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setFormulaAutocomplete,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    workbookRef,
    writeCellInputAt,
  } = options
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

function useSheetEditorAutocompleteRuntime(
  options: Pick<SheetEditorControllerOptions, 'entries' | 'locale' | 'sourceEntry' | 'vaultPath'> &
    Pick<SheetEditorCommitRuntime, 'commitSelectedCellInput'> &
    Pick<SheetEditorWorkbookRuntime, 'refreshWorkbook' | 'scheduleSerialize' | 'workbookRef'> &
    Pick<
      SheetEditorState,
      | 'formulaAutocomplete'
      | 'formulaInputRef'
      | 'setFormulaAutocomplete'
      | 'setWikilinkAutocomplete'
      | 'sheetElementRef'
      | 'typeEntryMap'
      | 'wikilinkAutocomplete'
      | 'wikilinkBaseItems'
      | 'wikilinkInputRef'
    >,
) {
  const {
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
  } = options
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

function useSheetEditorKeyboardInputRuntime(
  options: Pick<
    SheetEditorAutocompleteRuntime,
    'handleFormulaKeyDown' | 'handleWikilinkKeyDown' | 'updateSheetInlineAutocompletes'
  > &
    Pick<
      SheetEditorCommitRuntime,
      | 'commitExternalFormulaEditorInput'
      | 'commitSheetTextInput'
      | 'releaseSheetTextInputTarget'
      | 'trackSheetTextInputEdit'
    > &
    Pick<
      SheetEditorKeyboardRuntime,
      'captureSheetKeyboard' | 'releaseSheetKeyboard' | 'restoreSheetKeyboardFocus' | 'sheetKeyboardCapturedRef'
    > &
    Pick<
      SheetEditorWorkbookRuntime,
      | 'cancelScheduledSerialize'
      | 'refreshWorkbook'
      | 'scheduleSelectionChromePatch'
      | 'scheduleSerialize'
      | 'serializeCurrentWorkbook'
      | 'workbookRef'
    > &
    Pick<
      SheetEditorState,
      'setFormulaAutocomplete' | 'setSheetContextMenu' | 'setWikilinkAutocomplete' | 'sheetElementRef'
    >,
) {
  const {
    cancelScheduledSerialize,
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
    handleFormulaKeyDown,
    handleWikilinkKeyDown,
    refreshWorkbook,
    releaseSheetTextInputTarget,
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
    trackSheetTextInputEdit,
    updateSheetInlineAutocompletes,
    workbookRef,
  } = options
  const keyboardHandlers = useSheetKeyboardHandlers({
    cancelScheduledSerialize,
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
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
    commitSheetTextInput,
    releaseSheetTextInputTarget,
    scheduleSelectionChromePatch,
    scheduleSerialize,
    setFormulaAutocomplete,
    setWikilinkAutocomplete,
    sheetElementRef,
    trackSheetTextInputEdit,
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

function useSheetEditorPointerRuntime(
  options: Pick<SheetEditorControllerOptions, 'onNavigateWikilink'> &
    Pick<
      SheetEditorCommitRuntime,
      'commitExternalFormulaEditorInput' | 'commitSheetTextInput' | 'flushCurrentSheetContent'
    > &
    Pick<SheetEditorKeyboardRuntime, 'captureSheetKeyboard' | 'sheetFocusRequestRef' | 'sheetKeyboardCapturedRef'> &
    Pick<SheetEditorWorkbookRuntime, 'scheduleSelectionChromePatch' | 'sheetPointerActiveRef' | 'workbookRef'> &
    Pick<
      SheetEditorState,
      'setFormulaAutocomplete' | 'setSheetContextMenu' | 'setWikilinkAutocomplete' | 'sheetElementRef'
    >,
) {
  const {
    captureSheetKeyboard,
    commitExternalFormulaEditorInput,
    commitSheetTextInput,
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
  } = options
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
    commitSheetTextInput,
    handleSheetWikilinkPointerDown,
    scheduleSelectionChromePatch,
    setSheetContextMenu,
    setWikilinkAutocomplete,
    sheetElementRef,
    sheetFocusRequestRef,
    sheetKeyboardCapturedRef,
    sheetPointerActiveRef,
    workbookRef,
  })
}

type SheetEditorPointerRuntime = ReturnType<typeof useSheetEditorPointerRuntime>
type SheetEditorClipboardRuntime = ReturnType<typeof useSheetEditorClipboardRuntime>
type SheetEditorContextRuntime = ReturnType<typeof useSheetEditorContextRuntime>

function guardSheetInteraction<Args extends unknown[]>(handler: (...args: Args) => void) {
  return (...args: Args) => {
    try {
      handler(...args)
    } catch (error) {
      if (!isReleasedWorkbookModelError(error)) throw error
      console.warn('[sheet-editor] Skipped stale workbook interaction:', error)
    }
  }
}

function useSheetEditorInteractionHandlers(
  options: Pick<SheetEditorClipboardRuntime, 'handleCopyCapture' | 'handleCutCapture' | 'handlePasteCapture'> &
    Pick<SheetEditorContextRuntime, 'handleContextMenuCapture'> &
    Pick<
      SheetEditorKeyboardInputRuntime,
      'handleBlurCapture' | 'handleInputCapture' | 'handleKeyDownCapture' | 'handleKeyUpCapture' | 'handleSheetKeyDown'
    > &
    SheetEditorPointerRuntime,
) {
  const {
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
  } = options
  return useMemo(
    () => ({
    onBlurCapture: guardSheetInteraction(handleBlurCapture),
    onCopyCapture: guardSheetInteraction(handleCopyCapture),
    onCutCapture: guardSheetInteraction(handleCutCapture),
    onContextMenuCapture: guardSheetInteraction(handleContextMenuCapture),
    onInputCapture: guardSheetInteraction(handleInputCapture),
    onKeyDown: guardSheetInteraction(handleSheetKeyDown),
    onKeyDownCapture: guardSheetInteraction(handleKeyDownCapture),
    onKeyUpCapture: guardSheetInteraction(handleKeyUpCapture),
    onPasteCapture: guardSheetInteraction(handlePasteCapture),
    onPointerDownCapture: guardSheetInteraction(handlePointerDownCapture),
    onPointerMoveCapture: guardSheetInteraction(handlePointerMoveCapture),
    onPointerUpCapture: guardSheetInteraction(handlePointerUpCapture),
    }),
    [
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
    ],
  )
}

export function useSheetEditorController(options: SheetEditorControllerOptions) {
  const state = useSheetEditorState(options.entries)
  const { setFormulaAutocomplete } = state
  const selectFormulaAutocompleteIndex = useCallback(
    (index: number) => {
    setFormulaAutocomplete((current) => {
      if (!current) return null
      return { ...current, selectedIndex: index }
    })
    },
    [setFormulaAutocomplete],
  )
  const workbookRuntime = useSheetEditorWorkbookRuntime({
    ...options,
    ...state,
  })
  const keyboardRuntime = useSheetEditorKeyboardRuntime({
    ...workbookRuntime,
    ...state,
  })
  useGuardedWorkbookFocus({
    onWorkbookFocusBlocked: keyboardRuntime.releaseSheetKeyboard,
    sheetFocusSuppressedRef: keyboardRuntime.sheetFocusSuppressedRef,
    sheetElementRef: state.sheetElementRef,
    sheetKeyboardCapturedRef: keyboardRuntime.sheetKeyboardCapturedRef,
  })
  const contextRuntime = useSheetEditorContextRuntime({
    ...keyboardRuntime,
    ...workbookRuntime,
    ...state,
  })
  const commitRuntime = useSheetEditorCommitRuntime({
    ...options,
    ...state,
    ...workbookRuntime,
  })
  const clipboardRuntime = useSheetEditorClipboardRuntime({
    ...state,
    ...workbookRuntime,
    ...commitRuntime,
  })
  const autocompleteRuntime = useSheetEditorAutocompleteRuntime({
    ...options,
    ...state,
    ...workbookRuntime,
    ...commitRuntime,
  })
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
