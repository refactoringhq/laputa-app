export function visibleFormulaInput(container: HTMLDivElement | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!container) return null

  const inputs = Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
  return inputs.find((input): input is HTMLInputElement | HTMLTextAreaElement => {
    const rect = input.getBoundingClientRect()
    return rect.width > 0
      && rect.height > 0
      && input.value.trimStart().startsWith('=')
  }) ?? null
}
