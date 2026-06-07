export interface MouseMovementSnapshot {
  clientX: number
  clientY: number
  screenX: number
  screenY: number
}

export interface MouseMovementDecision {
  moved: boolean
  snapshot: MouseMovementSnapshot
}

export function detectIntentionalMouseMovement(
  event: Pick<MouseEvent, 'clientX' | 'clientY' | 'screenX' | 'screenY' | 'movementX' | 'movementY'>,
  previous: MouseMovementSnapshot | null,
): MouseMovementDecision {
  const snapshot = {
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
  }

  const movedByEventDelta = (event.movementX ?? 0) !== 0 || (event.movementY ?? 0) !== 0
  const movedFromPrevious = previous !== null && (
    snapshot.clientX !== previous.clientX ||
    snapshot.clientY !== previous.clientY ||
    snapshot.screenX !== previous.screenX ||
    snapshot.screenY !== previous.screenY
  )

  return {
    moved: movedByEventDelta || movedFromPrevious,
    snapshot,
  }
}
