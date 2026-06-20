import type { SheetFormulaSuggestion } from '../../utils/sheetFormulaAutocomplete'

export function dispatchSheetInput(input: HTMLInputElement | HTMLTextAreaElement, data: string): void {
  const event = typeof InputEvent === 'function'
    ? new InputEvent('input', {
      bubbles: true,
      data,
      inputType: 'insertReplacementText',
    })
    : new Event('input', { bubbles: true })

  input.dispatchEvent(event)
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

export function dispatchFormulaInput(input: HTMLInputElement | HTMLTextAreaElement, suggestion: SheetFormulaSuggestion): void {
  dispatchSheetInput(input, suggestion.name)
}

export function setFormulaInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const valueDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
  if (valueDescriptor?.set) {
    valueDescriptor.set.call(input, value)
    return
  }
  input.value = value
}
