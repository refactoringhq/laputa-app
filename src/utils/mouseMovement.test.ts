import { describe, expect, it } from 'vitest'
import { detectIntentionalMouseMovement } from './mouseMovement'

function mouseEvent(overrides: Partial<MouseEvent> = {}) {
  return {
    clientX: 10,
    clientY: 20,
    screenX: 30,
    screenY: 40,
    movementX: 0,
    movementY: 0,
    ...overrides,
  } as MouseEvent
}

function mouseEventWithoutMovementDeltas() {
  return {
    clientX: 10,
    clientY: 20,
    screenX: 30,
    screenY: 40,
  } as MouseEvent
}

describe('detectIntentionalMouseMovement', () => {
  it('treats the first zero-delta mousemove as positioning noise', () => {
    const decision = detectIntentionalMouseMovement(mouseEvent(), null)

    expect(decision.moved).toBe(false)
    expect(decision.snapshot).toEqual({
      clientX: 10,
      clientY: 20,
      screenX: 30,
      screenY: 40,
    })
  })

  it('treats missing movement deltas as zero', () => {
    const decision = detectIntentionalMouseMovement(mouseEventWithoutMovementDeltas(), null)

    expect(decision.moved).toBe(false)
  })

  it('detects movement from browser movement deltas', () => {
    const decision = detectIntentionalMouseMovement(mouseEvent({ movementX: 1 }), null)

    expect(decision.moved).toBe(true)
  })

  it('detects movement by comparing coordinates', () => {
    const previous = detectIntentionalMouseMovement(mouseEvent(), null).snapshot

    const decision = detectIntentionalMouseMovement(mouseEvent({ clientY: 21 }), previous)

    expect(decision.moved).toBe(true)
  })

  it('ignores repeated mousemove events at the same coordinates', () => {
    const previous = detectIntentionalMouseMovement(mouseEvent(), null).snapshot

    const decision = detectIntentionalMouseMovement(mouseEvent(), previous)

    expect(decision.moved).toBe(false)
  })
})
