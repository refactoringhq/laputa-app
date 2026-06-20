import type { FormulaAutocompleteState } from './sheetEditorAutocompleteState'

export function isInsideFormulaStringLiteral(value: string, cursor: number): boolean {
  if (!value.trimStart().startsWith('=')) return false

  let insideString = false
  for (let index = 0; index < cursor; index += 1) {
    if (value[index] !== '"') continue
    if (insideString && value[index + 1] === '"') {
      index += 1
      continue
    }
    insideString = !insideString
  }
  return insideString
}

export function isActiveWikilinkQueryInsideFormulaString(value: string, cursor: number): boolean {
  if (!value.trimStart().startsWith('=')) return false
  const activeQueryStart = value.slice(0, cursor).lastIndexOf('[[')
  return activeQueryStart >= 0 && isInsideFormulaStringLiteral(value, activeQueryStart)
}

export function formulaAutocompletePosition(
  input: HTMLInputElement | HTMLTextAreaElement,
  container: HTMLDivElement,
  cursor: number,
): Pick<FormulaAutocompleteState, 'left' | 'top' | 'width'> {
  const inputRect = input.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const inputStyle = window.getComputedStyle(input)
  const paddingLeft = Number.parseFloat(inputStyle.paddingLeft) || 0
  const font = [
    inputStyle.fontStyle,
    inputStyle.fontVariant,
    inputStyle.fontWeight,
    inputStyle.fontSize,
    inputStyle.fontFamily,
  ].join(' ')
  const measuredCursorOffset = measureFormulaTextWidth(input.value.slice(0, cursor), font) - input.scrollLeft
  const clampedCursorOffset = Math.max(0, Math.min(measuredCursorOffset, inputRect.width - paddingLeft - 24))
  const width = Math.max(240, Math.min(inputRect.width, 360))
  const rawLeft = inputRect.left - containerRect.left + paddingLeft + clampedCursorOffset

  return {
    left: Math.max(8, Math.min(rawLeft, containerRect.width - width - 8)),
    top: Math.max(8, inputRect.bottom - containerRect.top + 4),
    width,
  }
}

function measureFormulaTextWidth(text: string, font: string): number {
  const measurer = document.createElement('span')
  measurer.textContent = text
  measurer.style.contain = 'layout style paint'
  measurer.style.font = font
  measurer.style.position = 'absolute'
  measurer.style.visibility = 'hidden'
  measurer.style.whiteSpace = 'pre'
  document.body.append(measurer)
  const width = measurer.getBoundingClientRect().width
  measurer.remove()
  return width
}
