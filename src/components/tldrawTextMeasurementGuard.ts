import type { Editor } from 'tldraw'

type TextMeasure = Pick<Editor, 'textMeasure'>['textMeasure']
type MeasureElementTextNodeSpans = TextMeasure['measureElementTextNodeSpans']
type TextMeasurement = ReturnType<MeasureElementTextNodeSpans>
type TextMeasurementOptions = Parameters<MeasureElementTextNodeSpans>[1]

interface TextMeasurementHost {
  textMeasure: {
    measureElementTextNodeSpans: MeasureElementTextNodeSpans
  }
}

function isMissingRangeRectError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return message.includes('top') && (
    message.includes('cannot read')
    || message.includes('not an object')
    || message.includes('undefined')
  )
}

function finiteSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

function firstRenderedLine(text: string, options: TextMeasurementOptions): {
  didTruncate: boolean
  text: string
} {
  if (!options?.shouldTruncateToFirstLine) return { didTruncate: false, text }

  const lines = text.split(/\r?\n|\r/)
  return {
    didTruncate: lines.length > 1,
    text: lines[0] ?? '',
  }
}

function fallbackTextNodeSpans(element: HTMLElement, options: TextMeasurementOptions): TextMeasurement {
  const measuredText = firstRenderedLine(element.textContent ?? '', options)
  if (!measuredText.text) return { didTruncate: measuredText.didTruncate, spans: [] }

  const rect = element.getBoundingClientRect()
  return {
    didTruncate: measuredText.didTruncate,
    spans: [{
      box: {
        h: finiteSize(rect.height),
        w: finiteSize(rect.width),
        x: 0,
        y: 0,
      },
      text: measuredText.text,
    }],
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error !== 'object' || error === null || !('message' in error)) return ''

  const { message } = error
  return typeof message === 'string' ? message : ''
}

export function installTldrawTextMeasurementGuard(host: TextMeasurementHost): () => void {
  const { textMeasure } = host
  const originalMeasure = textMeasure.measureElementTextNodeSpans
  const guardedMeasure: MeasureElementTextNodeSpans = (element, options) => {
    try {
      return originalMeasure.call(textMeasure, element, options)
    } catch (error) {
      if (!isMissingRangeRectError(error)) throw error
      return fallbackTextNodeSpans(element, options)
    }
  }

  textMeasure.measureElementTextNodeSpans = guardedMeasure
  return () => {
    if (textMeasure.measureElementTextNodeSpans === guardedMeasure) {
      textMeasure.measureElementTextNodeSpans = originalMeasure
    }
  }
}
