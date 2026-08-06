import { CaretDown } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { translate } from '../lib/i18n'
import {
  DEFAULT_MARKDOWN_HIGHLIGHT_COLOR,
  markdownHighlightColorFromStyles,
} from '../utils/markdownHighlightMarkdown'
import { MarkdownHighlightColorMenu } from './markdownHighlightColorMenu'
import {
  useDocumentLocale,
  useEditorRevision,
  useToolbarControlState,
} from './markdownHighlightControlState'
import {
  toggleDefaultMarkdownHighlight,
  type HighlightEditor,
} from './markdownHighlightModel'
import { selectionOrHighlightRange } from './markdownHighlightRange'
import { Button } from './ui/button'

export function ToolbarHighlightColorControl({
  container,
  editor,
}: {
  container: Element
  editor: HighlightEditor
}) {
  const [open, setOpen] = useState(false)
  useEditorRevision(editor)
  const control = useToolbarControlState(container)
  const locale = useDocumentLocale()
  const range = selectionOrHighlightRange(editor)
  const currentColor = markdownHighlightColorFromStyles(editor.getActiveStyles())
    ?? DEFAULT_MARKDOWN_HIGHLIGHT_COLOR
  const label = translate(locale, 'editor.formatting.highlightColor')

  useEffect(() => {
    const button = control?.button
    if (!button) return

    button.classList.add('markdown-highlight-toolbar-main')
    const toggleDefault = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      toggleDefaultMarkdownHighlight(editor)
    }
    button.addEventListener('click', toggleDefault, true)
    return () => {
      button.removeEventListener('click', toggleDefault, true)
      button.classList.remove('markdown-highlight-toolbar-main')
    }
  }, [control?.button, editor])

  if (!control) return null

  return (
    <div
      className="markdown-highlight-toolbar-control"
      style={{ left: control.left, top: control.top }}
    >
      <MarkdownHighlightColorMenu
        currentColor={currentColor}
        editor={editor}
        onOpenChange={setOpen}
        open={open}
        range={range}
        source="toolbar"
        trigger={(
          <Button
            aria-label={label}
            className="markdown-highlight-toolbar-trigger"
            data-test="highlightColorMenu"
            onClick={() => setOpen(current => !current)}
            onPointerDown={event => event.preventDefault()}
            size="icon-xs"
            title={label}
            variant="ghost"
          >
            <CaretDown aria-hidden="true" className="markdown-highlight-toolbar-trigger-icon" />
          </Button>
        )}
      />
    </div>
  )
}
