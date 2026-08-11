const RELEASED_WORKBOOK_MODEL_ERROR = 'null pointer passed to rust'
const WASM_BINDGEN_STACK_POINTER_EXPORT = '__wbindgen_add_to_stack_pointer'

export function isReleasedWorkbookModelError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(RELEASED_WORKBOOK_MODEL_ERROR)
}

export function isIronCalcWasmBridgeError(error: unknown): boolean {
  return isReleasedWorkbookModelError(error)
    || (error instanceof Error && error.message.includes(WASM_BINDGEN_STACK_POINTER_EXPORT))
}
