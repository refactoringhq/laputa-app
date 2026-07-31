type SheetInputTarget = HTMLInputElement | HTMLTextAreaElement

export function dispatchSheetInput(input: SheetInputTarget | null | undefined): boolean {
  if (!input) return false

  const event = typeof InputEvent === 'function'
    ? new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
    })
    : new Event('input', { bubbles: true })

  input.dispatchEvent(event)
  input.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}

export function dispatchFormulaInput(input: SheetInputTarget | null | undefined): boolean {
  return dispatchSheetInput(input)
}

export function setFormulaInputValue(input: SheetInputTarget, value: string): void {
  const valueDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  if (valueDescriptor?.set) {
    valueDescriptor.set.call(input, value)
    return
  }
  input.value = value
}
