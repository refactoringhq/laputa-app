import { useEffect, useEffectEvent } from 'react'
import { clearDraggedNotePath, readDraggedNotePath } from '../utils/noteDragDrop'

const NOTE_DROP_TARGET_SELECTOR = '[data-note-drop-type], [data-note-drop-folder]'
const NOTE_DROP_STATE_ATTRIBUTE = 'data-note-drop-state'

type NoteDropMutation = (notePath: string, destination: string) => Promise<unknown> | unknown

interface SidebarNoteDropTargetsInput {
  canDropNoteOnType: (notePath: string, type: string) => boolean
  canDropNoteOnFolder: (notePath: string, folderPath: string) => boolean
  changeNoteType: NoteDropMutation
  moveNoteToFolder: NoteDropMutation
}

type NoteDropDestination = {
  element: HTMLElement
  kind: 'type' | 'folder'
  value: string
}

function dropTargetFromEvent(event: DragEvent): HTMLElement | null {
  if (!(event.target instanceof Element)) return null
  return event.target.closest<HTMLElement>(NOTE_DROP_TARGET_SELECTOR)
}

function destinationForElement(element: HTMLElement | null): NoteDropDestination | null {
  if (!element) return null
  const type = element.dataset.noteDropType
  if (type !== undefined) return { element, kind: 'type', value: type }
  const folder = element.dataset.noteDropFolder
  if (folder !== undefined) return { element, kind: 'folder', value: folder }
  return null
}

function canAcceptDestination(
  options: SidebarNoteDropTargetsInput,
  notePath: string,
  destination: NoteDropDestination,
): boolean {
  return destination.kind === 'type'
    ? options.canDropNoteOnType(notePath, destination.value)
    : options.canDropNoteOnFolder(notePath, destination.value)
}

function runDestinationMutation(
  options: SidebarNoteDropTargetsInput,
  notePath: string,
  destination: NoteDropDestination,
): void {
  const mutation = destination.kind === 'type' ? options.changeNoteType : options.moveNoteToFolder
  void Promise.resolve(mutation(notePath, destination.value)).catch(() => {})
}

function stopHandledDrop(event: DragEvent): void {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

export function useSidebarNoteDropTargets(options: SidebarNoteDropTargetsInput): void {
  const canAccept = useEffectEvent((notePath: string, destination: NoteDropDestination) =>
    canAcceptDestination(options, notePath, destination),
  )
  const runMutation = useEffectEvent((notePath: string, destination: NoteDropDestination) =>
    runDestinationMutation(options, notePath, destination),
  )

  useEffect(() => {
    let activeTarget: HTMLElement | null = null

    const setActiveTarget = (nextTarget: HTMLElement | null) => {
      if (activeTarget === nextTarget) return
      activeTarget?.removeAttribute(NOTE_DROP_STATE_ATTRIBUTE)
      activeTarget = nextTarget
      activeTarget?.setAttribute(NOTE_DROP_STATE_ATTRIBUTE, 'valid')
    }

    const updateTarget = (event: DragEvent): NoteDropDestination | null => {
      const notePath = readDraggedNotePath(event.dataTransfer)
      const destination = destinationForElement(dropTargetFromEvent(event))
      const valid = !!notePath && !!destination && canAccept(notePath, destination)
      setActiveTarget(valid ? destination.element : null)
      if (!valid) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
        return null
      }
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      return destination
    }

    const handleDragEnter = (event: DragEvent) => {
      updateTarget(event)
    }

    const handleDragOver = (event: DragEvent) => {
      updateTarget(event)
    }

    const handleDragLeave = (event: DragEvent) => {
      if (!activeTarget) return
      const relatedTarget =
        event.relatedTarget instanceof Element
          ? event.relatedTarget.closest<HTMLElement>(NOTE_DROP_TARGET_SELECTOR)
          : null
      if (!event.relatedTarget) return
      if (relatedTarget === activeTarget) return
      setActiveTarget(null)
    }

    const handleDrop = (event: DragEvent) => {
      const notePath = readDraggedNotePath(event.dataTransfer)
      const destination = destinationForElement(dropTargetFromEvent(event))
      const valid = !!notePath && !!destination && canAccept(notePath, destination)
      setActiveTarget(null)
      clearDraggedNotePath()
      if (!notePath || !destination) return
      stopHandledDrop(event)
      if (!valid) return
      runMutation(notePath, destination)
    }

    const handleDragEnd = () => {
      setActiveTarget(null)
      clearDraggedNotePath()
    }

    document.addEventListener('dragenter', handleDragEnter, true)
    document.addEventListener('dragover', handleDragOver, true)
    document.addEventListener('dragleave', handleDragLeave, true)
    document.addEventListener('drop', handleDrop, true)
    document.addEventListener('dragend', handleDragEnd, true)
    return () => {
      document.removeEventListener('dragenter', handleDragEnter, true)
      document.removeEventListener('dragover', handleDragOver, true)
      document.removeEventListener('dragleave', handleDragLeave, true)
      document.removeEventListener('drop', handleDrop, true)
      document.removeEventListener('dragend', handleDragEnd, true)
      handleDragEnd()
    }
  }, [])
}
