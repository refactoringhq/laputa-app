export const EDITOR_FIND_AVAILABILITY_EVENT = 'laputa:editor-find-availability'

interface EditorFindAvailabilityDetail {
  enabled: boolean
}

function isAvailabilityDetail(detail: unknown): detail is EditorFindAvailabilityDetail {
  return typeof detail === 'object'
    && detail !== null
    && 'enabled' in detail
    && typeof (detail as { enabled?: unknown }).enabled === 'boolean'
}

export function dispatchEditorFindAvailability(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent<EditorFindAvailabilityDetail>(
    EDITOR_FIND_AVAILABILITY_EVENT,
    { detail: { enabled } },
  ))
}

export function readEditorFindAvailability(event: Event): boolean | null {
  if (!(event instanceof CustomEvent) || !isAvailabilityDetail(event.detail)) return null
  return event.detail.enabled
}
