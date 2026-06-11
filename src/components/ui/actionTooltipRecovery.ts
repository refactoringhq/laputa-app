const ACTION_TOOLTIP_RECOVERY_BOUNDARY_NAME = 'ActionTooltipBoundary'
const RECOVERED_ACTION_TOOLTIP_ERROR_MARK = '__tolariaRecoveredActionTooltipError'

type MarkedRecoveredActionTooltipError = Error & {
  [RECOVERED_ACTION_TOOLTIP_ERROR_MARK]?: true
}

function hasRecoveredActionTooltipMark(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return Reflect.get(error as MarkedRecoveredActionTooltipError, RECOVERED_ACTION_TOOLTIP_ERROR_MARK) === true
}

export function markRecoveredActionTooltipError(error: unknown): void {
  if (!(error instanceof Error)) return
  Reflect.set(error as MarkedRecoveredActionTooltipError, RECOVERED_ACTION_TOOLTIP_ERROR_MARK, true)
}

export function isRecoveredActionTooltipError(error: unknown, componentStack = ''): boolean {
  return hasRecoveredActionTooltipMark(error)
    || componentStack.includes(ACTION_TOOLTIP_RECOVERY_BOUNDARY_NAME)
}
