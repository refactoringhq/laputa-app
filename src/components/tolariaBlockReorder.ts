import {
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  blockElementById,
  blockElementFromPoint,
  blockIdFromElement,
  dropPlacementForPoint,
  editorBlockElement,
  type DropPlacement,
  type TolariaBlockNoteEditor,
} from './tolariaBlockNoteDom'
import {
  hasChildBlock,
  liveSideMenuBlock,
  runSideMenuAction,
  type SideMenuBlock,
} from './tolariaSideMenuBlocks'

type PointerReorderState = {
  affordances?: ReorderAffordances
  clearListeners: () => void
  draggedBlockId: string
  editorElement: HTMLElement
  hasMoved: boolean
  lastDropTarget: DropTarget | null
  ownerDocument: Document
  pointerId: number
  startX: number
  startY: number
}
type ReorderAffordances = {
  draggedElement: HTMLElement
  dropIndicator: HTMLElement
  pointerOffsetX: number
  pointerOffsetY: number
  preview: HTMLElement
  previousDraggedOpacity: string
}
type DropTarget = {
  blockId: string
  element: HTMLElement
  placement: DropPlacement
}

const POINTER_REORDER_THRESHOLD_PX = 4

function styleDragPreview(preview: HTMLElement, rect: DOMRect) {
  preview.setAttribute('data-testid', 'editor-block-drag-preview')
  preview.setAttribute('aria-hidden', 'true')
  preview.className = 'editor__blocknote-container'
  preview.style.position = 'fixed'
  preview.style.width = `${rect.width}px`
  preview.style.maxHeight = `${Math.max(rect.height, 1)}px`
  preview.style.overflow = 'hidden'
  preview.style.pointerEvents = 'none'
  preview.style.opacity = '0.72'
  preview.style.zIndex = '14000'
  preview.style.boxSizing = 'border-box'
  preview.style.borderRadius = '6px'
  preview.style.background = 'var(--bg-primary, white)'
  preview.style.boxShadow = '0 10px 26px rgba(15, 23, 42, 0.18)'
}

function createDragPreview(draggedElement: HTMLElement, ownerDocument: Document): HTMLElement {
  const preview = ownerDocument.createElement('div')
  const clone = draggedElement.cloneNode(true)
  const rect = draggedElement.getBoundingClientRect()

  if (clone instanceof HTMLElement) {
    clone.style.margin = '0'
    clone.style.width = '100%'
    clone.style.pointerEvents = 'none'
    preview.appendChild(clone)
  }
  styleDragPreview(preview, rect)
  ownerDocument.body.appendChild(preview)

  return preview
}

function createDropIndicator(ownerDocument: Document): HTMLElement {
  const indicator = ownerDocument.createElement('div')
  indicator.setAttribute('data-testid', 'editor-block-drop-indicator')
  indicator.style.position = 'fixed'
  indicator.style.height = '2px'
  indicator.style.pointerEvents = 'none'
  indicator.style.background = 'var(--border-focus, #155dff)'
  indicator.style.borderRadius = '999px'
  indicator.style.boxShadow = '0 0 0 1px rgba(21, 93, 255, 0.12), 0 0 10px rgba(21, 93, 255, 0.28)'
  indicator.style.zIndex = '14001'
  indicator.style.display = 'none'
  ownerDocument.body.appendChild(indicator)

  return indicator
}

function createReorderAffordances(state: PointerReorderState): ReorderAffordances | undefined {
  const draggedElement = blockElementById(state.editorElement, state.draggedBlockId)
  if (!draggedElement) return undefined

  const rect = draggedElement.getBoundingClientRect()
  const previousDraggedOpacity = draggedElement.style.opacity
  const preview = createDragPreview(draggedElement, state.ownerDocument)
  draggedElement.style.opacity = '0.35'

  return {
    draggedElement,
    dropIndicator: createDropIndicator(state.ownerDocument),
    pointerOffsetX: state.startX - rect.left,
    pointerOffsetY: state.startY - rect.top,
    preview,
    previousDraggedOpacity,
  }
}

function cleanupReorderAffordances(affordances: ReorderAffordances | undefined) {
  if (!affordances) return

  affordances.draggedElement.style.opacity = affordances.previousDraggedOpacity
  affordances.preview.remove()
  affordances.dropIndicator.remove()
}

function updateDragPreview(affordances: ReorderAffordances, x: number, y: number) {
  affordances.preview.style.left = `${x - affordances.pointerOffsetX}px`
  affordances.preview.style.top = `${y - affordances.pointerOffsetY}px`
}

function hideDropIndicator(affordances: ReorderAffordances | undefined) {
  if (affordances) affordances.dropIndicator.style.display = 'none'
}

function updateDropIndicator(affordances: ReorderAffordances | undefined, target: DropTarget | null) {
  if (!affordances || !target) {
    hideDropIndicator(affordances)
    return
  }

  const rect = target.element.getBoundingClientRect()
  affordances.dropIndicator.style.display = 'block'
  affordances.dropIndicator.style.left = `${rect.left}px`
  affordances.dropIndicator.style.top = `${target.placement === 'before' ? rect.top - 1 : rect.bottom - 1}px`
  affordances.dropIndicator.style.width = `${rect.width}px`
}

function validDropTarget({
  editor,
  state,
  x,
  y,
}: {
  editor: TolariaBlockNoteEditor
  state: PointerReorderState
  x: number
  y: number
}): DropTarget | null {
  const targetElement = blockElementFromPoint({
    editorElement: state.editorElement,
    ownerDocument: state.ownerDocument,
    x,
    y,
  })
  if (!targetElement) return null

  const blockId = blockIdFromElement(targetElement)
  if (!blockId || blockId === state.draggedBlockId) return null

  const draggedBlock = liveSideMenuBlock(editor, { id: state.draggedBlockId })
  const targetBlock = liveSideMenuBlock(editor, { id: blockId })
  if (!draggedBlock || !targetBlock || hasChildBlock(draggedBlock, blockId)) return null

  return {
    blockId,
    element: targetElement,
    placement: dropPlacementForPoint(targetElement, y),
  }
}

function moveBlockByPointerDrop({
  editor,
  draggedBlockId,
  targetBlockId,
  placement,
}: {
  editor: TolariaBlockNoteEditor
  draggedBlockId: string
  targetBlockId: string
  placement: DropPlacement
}): boolean {
  if (draggedBlockId === targetBlockId) return false

  const draggedBlock = liveSideMenuBlock(editor, { id: draggedBlockId })
  const targetBlock = liveSideMenuBlock(editor, { id: targetBlockId })
  if (!draggedBlock || !targetBlock || hasChildBlock(draggedBlock, targetBlockId)) return false

  let moved = false
  runSideMenuAction(() => {
    editor.focus()
    editor.transact(() => {
      const currentDraggedBlock = liveSideMenuBlock(editor, { id: draggedBlockId })
      const currentTargetBlock = liveSideMenuBlock(editor, { id: targetBlockId })
      if (!currentDraggedBlock || !currentTargetBlock) return
      if (hasChildBlock(currentDraggedBlock, targetBlockId)) return

      editor.removeBlocks([currentDraggedBlock.id])
      editor.insertBlocks([currentDraggedBlock], currentTargetBlock.id, placement)
      moved = true
    })
  })

  return moved
}

export function usePointerBlockReorder(
  editor: TolariaBlockNoteEditor,
  block: SideMenuBlock | undefined,
) {
  const reorderStateRef = useRef<PointerReorderState | null>(null)
  const suppressNextClickRef = useRef(false)

  const clearReorderState = useCallback(() => {
    const state = reorderStateRef.current
    if (state) {
      state.clearListeners()
      cleanupReorderAffordances(state.affordances)
    }
    reorderStateRef.current = null
  }, [])

  const finishPointerReorder = useCallback((event: PointerEvent) => {
    const state = reorderStateRef.current
    if (!state || event.pointerId !== state.pointerId) return

    clearReorderState()
    if (!state.hasMoved) return

    event.preventDefault()
    suppressNextClickRef.current = true
    const dropTarget = state.lastDropTarget ?? validDropTarget({
      editor,
      state,
      x: event.clientX,
      y: event.clientY,
    })
    if (!dropTarget) return

    const moved = moveBlockByPointerDrop({
      editor,
      draggedBlockId: state.draggedBlockId,
      targetBlockId: dropTarget.blockId,
      placement: dropTarget.placement,
    })

    if (!moved) suppressNextClickRef.current = false
  }, [clearReorderState, editor])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if ((typeof event.button === 'number' && event.button !== 0) || !event.isPrimary) return

    runSideMenuAction(() => {
      const liveBlock = liveSideMenuBlock(editor, block)
      const editorElement = editorBlockElement(editor)
      if (!liveBlock || !editorElement) {
        event.preventDefault()
        return
      }

      clearReorderState()
      const ownerDocument = event.currentTarget.ownerDocument
      const pointerId = event.pointerId
      const handlePointerMove = (nativeEvent: PointerEvent) => {
        const state = reorderStateRef.current
        if (!state || nativeEvent.pointerId !== state.pointerId) return

        const distance = Math.hypot(
          nativeEvent.clientX - state.startX,
          nativeEvent.clientY - state.startY,
        )
        const movementStarted = [state.hasMoved, distance >= POINTER_REORDER_THRESHOLD_PX]
          .includes(true)
        if (!movementStarted) return

        state.hasMoved = true
        suppressNextClickRef.current = true
        state.affordances ??= createReorderAffordances(state)
        if (!state.affordances) return

        updateDragPreview(state.affordances, nativeEvent.clientX, nativeEvent.clientY)
        state.lastDropTarget = validDropTarget({
          editor,
          state,
          x: nativeEvent.clientX,
          y: nativeEvent.clientY,
        })
        updateDropIndicator(state.affordances, state.lastDropTarget)
        nativeEvent.preventDefault()
      }
      const handlePointerUp = (nativeEvent: PointerEvent) => { finishPointerReorder(nativeEvent); }
      const handlePointerCancel = (nativeEvent: PointerEvent) => {
        if (nativeEvent.pointerId !== pointerId) return
        clearReorderState()
      }

      ownerDocument.addEventListener('pointermove', handlePointerMove, true)
      ownerDocument.addEventListener('pointerup', handlePointerUp, true)
      ownerDocument.addEventListener('pointercancel', handlePointerCancel, true)

      reorderStateRef.current = {
        clearListeners: () => {
          ownerDocument.removeEventListener('pointermove', handlePointerMove, true)
          ownerDocument.removeEventListener('pointerup', handlePointerUp, true)
          ownerDocument.removeEventListener('pointercancel', handlePointerCancel, true)
        },
        draggedBlockId: liveBlock.id,
        editorElement,
        hasMoved: false,
        lastDropTarget: null,
        ownerDocument,
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
      }
      try {
        if ('setPointerCapture' in event.currentTarget) event.currentTarget.setPointerCapture(pointerId)
      } catch {
        // Document-level pointer listeners still complete the reorder gesture.
      }
    })
  }, [block, clearReorderState, editor, finishPointerReorder])

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressNextClickRef.current) return

    suppressNextClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return { onClickCapture, onPointerDown }
}
