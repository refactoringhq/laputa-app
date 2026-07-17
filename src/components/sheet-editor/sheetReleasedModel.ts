const RELEASED_WORKBOOK_MODEL_ERROR = 'null pointer passed to rust'

export function isReleasedWorkbookModelError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(RELEASED_WORKBOOK_MODEL_ERROR)
}
