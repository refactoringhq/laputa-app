import { useCallback, useEffect, type MutableRefObject } from 'react'
import type { useCreateBlockNote } from '@blocknote/react'
import type { VaultEntry } from '../types'
import type { RichEditorBlockTypeDefinition } from '../utils/richEditorBlockTypes'
import { turnCurrentBlockIntoType } from './richEditorBlockTypeCommands'

type TurnCurrentBlockIntoEditor = ReturnType<typeof useCreateBlockNote>

type TurnCurrentBlockIntoActiveTab = {
  entry: Pick<VaultEntry, 'fileKind'>
} | null

interface TurnCurrentBlockIntoCommandConfig {
  activeTab: TurnCurrentBlockIntoActiveTab
  diffMode: boolean
  editor: TurnCurrentBlockIntoEditor
  rawMode: boolean
  turnCurrentBlockIntoRef?: MutableRefObject<((target: RichEditorBlockTypeDefinition) => void) | null>
}

export function useTurnCurrentBlockIntoCommand({
  activeTab,
  diffMode,
  editor,
  rawMode,
  turnCurrentBlockIntoRef,
}: TurnCurrentBlockIntoCommandConfig) {
  const handleTurnCurrentBlockInto = useCallback((target: RichEditorBlockTypeDefinition) => {
    if (!activeTab || activeTab.entry.fileKind === 'binary' || rawMode || diffMode) return
    turnCurrentBlockIntoType(editor, target, 'command_palette')
  }, [activeTab, diffMode, editor, rawMode])

  useEffect(() => {
    if (!turnCurrentBlockIntoRef) return

    turnCurrentBlockIntoRef.current = handleTurnCurrentBlockInto
    return () => {
      if (turnCurrentBlockIntoRef.current === handleTurnCurrentBlockInto) {
        turnCurrentBlockIntoRef.current = null
      }
    }
  }, [handleTurnCurrentBlockInto, turnCurrentBlockIntoRef])
}
