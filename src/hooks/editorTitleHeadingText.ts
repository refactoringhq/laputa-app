const TITLE_HEADING_SELECTOR = '.bn-editor h1, .bn-editor [data-content-type="heading"][data-level="1"], .bn-editor [data-content-type="heading"]:not([data-level])'

export interface TitleHeadingTextBlock {
  content?: unknown
}

export function headingBlockText(block: TitleHeadingTextBlock | undefined): string {
  if (!Array.isArray(block?.content)) return ''

  return block.content
    .filter((item): item is { type?: string; text?: string } => (
      typeof item === 'object' && item !== null
    ))
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('')
    .trim()
}

export function hasTitleHeadingText(block: TitleHeadingTextBlock | undefined): boolean {
  const domText = document.querySelector<HTMLElement>(TITLE_HEADING_SELECTOR)?.textContent?.trim() ?? ''

  return domText.length > 0 || headingBlockText(block).length > 0
}
