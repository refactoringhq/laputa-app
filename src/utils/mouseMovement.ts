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

const MOUSE_POSITION_KEYS: Array<keyof MouseMovementSnapshot> = ['clientX', 'clientY', 'screenX', 'screenY']

function hasNonZeroMovementDelta(
  event: Pick<MouseEvent, 'movementX' | 'movementY'>,
): boolean {
  return (event.movementX ?? 0) !== 0 || (event.movementY ?? 0) !== 0
}

function hasChangedMousePosition(
  snapshot: MouseMovementSnapshot,
  previous: MouseMovementSnapshot | null,
): boolean {
  if (!previous) return false
  return MOUSE_POSITION_KEYS.some((key) => snapshot[key] !== previous[key])
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

  return {
    moved: hasNonZeroMovementDelta(event) || hasChangedMousePosition(snapshot, previous),
    snapshot,
  }
}