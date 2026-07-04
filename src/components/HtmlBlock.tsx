import {
  ArrowsClockwise,
  ArrowsOutLineVertical,
  Code,
  Copy,
} from '@phosphor-icons/react'
import {
  useMemo,
  useState,
} from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent } from 'react'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../hooks/appCommandDispatcher'
import { translate } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'
import { writeClipboardText } from '../utils/clipboardText'
import {
  clampHtmlBlockHeight,
  HTML_BLOCK_DEFAULT_HEIGHT,
  HTML_BLOCK_TYPE,
  normalizeHtmlBlockHeight,
} from '../utils/htmlBlockMarkdown'
import { htmlBlockPreview } from '../utils/htmlBlockSandbox'
import { dispatchRichEditorExternalChange } from './editorExternalChangeEvents'
import { Button } from './ui/button'

export interface HtmlBlockProps {
  height: string
  html: string
}

export interface HtmlBlockEditor {
  domElement?: EventTarget | null
  focus?: () => void
  getBlock: (blockId: string) => unknown
  updateBlock: (blockId: string, update: HtmlBlockUpdate) => unknown
}

interface HtmlBlockUpdate {
  props: HtmlBlockProps
  type: typeof HTML_BLOCK_TYPE
}

interface HtmlBlockViewProps {
  block: {
    id: string
    props: HtmlBlockProps
  }
  editor: HtmlBlockEditor
}

interface LiveHtmlBlock {
  id: string
  props: HtmlBlockProps
}

type HeightChangeSource = 'keyboard' | 'pointer' | 'reset'

const HEIGHT_KEYBOARD_STEP = 24
const HEIGHT_KEYBOARD_LARGE_STEP = 96

function stopHtmlBlockEvent(event: SyntheticEvent): void {
  event.stopPropagation()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function htmlBlockProps(value: unknown): HtmlBlockProps | null {
  if (!isRecord(value) || typeof value.html !== 'string') return null
  return {
    height: normalizeHtmlBlockHeight(value.height),
    html: value.html,
  }
}

function liveHtmlBlock(value: unknown): LiveHtmlBlock | null {
  if (!isRecord(value) || value.type !== HTML_BLOCK_TYPE || typeof value.id !== 'string') return null

  const props = htmlBlockProps(value.props)
  return props ? { id: value.id, props } : null
}

function isMissingBlockError(error: unknown): error is Error {
  return error instanceof Error
    && error.message.includes('Block with ID')
    && error.message.includes('not found')
}

function warnStaleHtmlBlockUpdate(error: Error): void {
  console.warn('[editor] Ignored stale HTML block update:', error)
}

function getLiveHtmlBlock(editor: HtmlBlockEditor, blockId: string): LiveHtmlBlock | null {
  try {
    return liveHtmlBlock(editor.getBlock(blockId))
  } catch (error) {
    if (!isMissingBlockError(error)) throw error

    warnStaleHtmlBlockUpdate(error)
    return null
  }
}

function updateHtmlBlockPropsSafely(
  editor: HtmlBlockEditor,
  blockId: string,
  nextProps: (props: HtmlBlockProps) => HtmlBlockProps,
): boolean {
  const liveBlock = getLiveHtmlBlock(editor, blockId)
  if (!liveBlock) return false

  try {
    editor.updateBlock(liveBlock.id, {
      props: nextProps(liveBlock.props),
      type: HTML_BLOCK_TYPE,
    })
    return true
  } catch (error) {
    if (!isMissingBlockError(error)) throw error

    warnStaleHtmlBlockUpdate(error)
    return false
  }
}

function dispatchEditorChange(editor: HtmlBlockEditor): void {
  dispatchRichEditorExternalChange(editor, editor.domElement ?? undefined)
}

function t(key: Parameters<typeof translate>[1]): string {
  return translate('en', key)
}

function openRawEditorForHtmlSource(event: SyntheticEvent): void {
  event.preventDefault()
  event.stopPropagation()
  window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT_NAME, {
    detail: APP_COMMAND_IDS.editToggleRawEditor,
  }))
}

function heightFromKeyboard(currentHeight: string, key: string): string | null {
  const current = Number.parseInt(normalizeHtmlBlockHeight(currentHeight), 10)
  if (key === 'ArrowUp') return clampHtmlBlockHeight(current - HEIGHT_KEYBOARD_STEP)
  if (key === 'ArrowDown') return clampHtmlBlockHeight(current + HEIGHT_KEYBOARD_STEP)
  if (key === 'PageUp') return clampHtmlBlockHeight(current - HEIGHT_KEYBOARD_LARGE_STEP)
  if (key === 'PageDown') return clampHtmlBlockHeight(current + HEIGHT_KEYBOARD_LARGE_STEP)
  if (key === 'Home') return clampHtmlBlockHeight(Number.parseInt(HTML_BLOCK_DEFAULT_HEIGHT, 10))
  return null
}

export function HtmlBlock({ block, editor }: HtmlBlockViewProps) {
  const currentHtml = block.props.html
  const currentHeight = normalizeHtmlBlockHeight(block.props.height)
  const preview = useMemo(() => htmlBlockPreview(currentHtml), [currentHtml])
  const { sanitizedHtml, srcDoc } = preview
  const [resizingHeight, setResizingHeight] = useState<string | null>(null)
  const displayHeight = resizingHeight ?? currentHeight
  const blockedMarkup = currentHtml.trim().length > 0 && sanitizedHtml.trim().length === 0

  const updateHeight = (height: string, source: HeightChangeSource) => {
    const updated = updateHtmlBlockPropsSafely(editor, block.id, props => ({
      ...props,
      height,
    }))
    if (!updated) return

    dispatchEditorChange(editor)
    trackEvent('editor_html_block_height_changed', { height: Number.parseInt(height, 10), source })
  }

  const resetHeight = (event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
    updateHeight(HTML_BLOCK_DEFAULT_HEIGHT, 'reset')
  }

  const copySource = (event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
    void writeClipboardText(currentHtml)
      .then(() => trackEvent('editor_html_block_source_copied', { outcome: 'success' }))
      .catch((error) => {
        console.warn('[editor] Failed to copy HTML block source:', error)
        trackEvent('editor_html_block_source_copied', { outcome: 'failed' })
      })
  }

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const startHeight = Number.parseInt(displayHeight, 10)
    const startY = event.clientY

    const onPointerMove = (moveEvent: PointerEvent) => {
      setResizingHeight(clampHtmlBlockHeight(startHeight + moveEvent.clientY - startY))
    }

    const onPointerUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      setResizingHeight(null)
      updateHeight(clampHtmlBlockHeight(startHeight + upEvent.clientY - startY), 'pointer')
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
  }

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextHeight = heightFromKeyboard(displayHeight, event.key)
    if (nextHeight === null) return

    event.preventDefault()
    event.stopPropagation()
    updateHeight(nextHeight, 'keyboard')
  }

  return (
    <section
      className="html-block"
      contentEditable={false}
      data-html-block
      aria-label={t('editor.htmlBlock.previewTitle')}
      onMouseDown={stopHtmlBlockEvent}
      onPointerDown={stopHtmlBlockEvent}
      style={{ height: `${displayHeight}px` }}
      suppressContentEditableWarning
    >
      <div className="html-block__toolbar" aria-label={t('editor.htmlBlock.toolbar')} role="toolbar">
        <Button
          aria-label={t('editor.htmlBlock.copySource')}
          onClick={copySource}
          onMouseDown={stopHtmlBlockEvent}
          size="icon-xs"
          title={t('editor.htmlBlock.copySource')}
          type="button"
          variant="outline"
        >
          <Copy aria-hidden="true" />
        </Button>
        <Button
          aria-label={t('editor.htmlBlock.openRawEditor')}
          onClick={openRawEditorForHtmlSource}
          onMouseDown={stopHtmlBlockEvent}
          size="icon-xs"
          title={t('editor.htmlBlock.openRawEditor')}
          type="button"
          variant="outline"
        >
          <Code aria-hidden="true" />
        </Button>
        <Button
          aria-label={t('editor.htmlBlock.resetHeight')}
          onClick={resetHeight}
          onMouseDown={stopHtmlBlockEvent}
          size="icon-xs"
          title={t('editor.htmlBlock.resetHeight')}
          type="button"
          variant="outline"
        >
          <ArrowsClockwise aria-hidden="true" />
        </Button>
      </div>

      {blockedMarkup ? (
        <div className="html-block__fallback" role="alert">
          <span>{t('editor.htmlBlock.blockedFallback')}</span>
          <Button
            onClick={openRawEditorForHtmlSource}
            onMouseDown={stopHtmlBlockEvent}
            type="button"
            variant="outline"
            size="sm"
          >
            <Code aria-hidden="true" />
            {t('editor.htmlBlock.openRawEditor')}
          </Button>
        </div>
      ) : (
        <iframe
          className="html-block__frame"
          referrerPolicy="no-referrer"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          title={t('editor.htmlBlock.previewTitle')}
        />
      )}

      <Button
        aria-label={t('editor.htmlBlock.resizeHeight')}
        className="html-block__resize-handle"
        onKeyDown={handleResizeKeyDown}
        onMouseDown={stopHtmlBlockEvent}
        onPointerDown={startResize}
        size="icon-xs"
        title={t('editor.htmlBlock.resizeHeight')}
        type="button"
        variant="ghost"
      >
        <ArrowsOutLineVertical aria-hidden="true" />
      </Button>
    </section>
  )
}
