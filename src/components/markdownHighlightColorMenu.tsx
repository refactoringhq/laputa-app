import { Check } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import {
  MARKDOWN_HIGHLIGHT_COLORS,
  type MarkdownHighlightColor,
} from '../utils/markdownHighlightMarkdown'
import { colorLabel, useDocumentLocale } from './markdownHighlightControlState'
import {
  applyMarkdownHighlightColor,
  type HighlightControlSource,
  type HighlightEditor,
  type HighlightRange,
} from './markdownHighlightModel'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface MarkdownHighlightColorMenuProps {
  currentColor: MarkdownHighlightColor
  editor: HighlightEditor
  onOpenChange?: (open: boolean) => void
  open?: boolean
  range: HighlightRange | null
  source: HighlightControlSource
  trigger: ReactNode
}

export function MarkdownHighlightColorMenu(props: MarkdownHighlightColorMenuProps) {
  const { currentColor, editor, onOpenChange, open, range, source, trigger } = props
  const locale = useDocumentLocale()

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {MARKDOWN_HIGHLIGHT_COLORS.map(color => (
          <DropdownMenuItem
            key={color}
            onSelect={() => applyMarkdownHighlightColor(editor, color, range, source)}
          >
            <span
              aria-hidden="true"
              className={`markdown-highlight-color-swatch markdown-highlight-color-swatch--${color}`}
            />
            <span>{colorLabel(locale, color)}</span>
            {currentColor === color && <Check aria-hidden="true" className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
