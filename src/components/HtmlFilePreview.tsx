import { convertFileSrc } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef } from 'react'
import { trackEvent } from '../lib/telemetry'
import { htmlFilePreviewSrcDoc } from '../utils/htmlFilePreview'
import { focusNoteListContainer } from '../utils/neighborhoodHistory'
import { Button } from './ui/button'

interface HtmlFilePreviewProps {
  content: string
  path: string
  title: string
  vaultPath: string
}

function releaseFrameFocus(frame: HTMLIFrameElement | null, focusTarget: HTMLButtonElement | null) {
  if (!frame || document.activeElement !== frame) return
  frame.blur()
  focusTarget?.focus()
}

export function HtmlFilePreview({ content, path, title, vaultPath }: HtmlFilePreviewProps) {
  const focusTargetRef = useRef<HTMLButtonElement | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const srcDoc = useMemo(() => htmlFilePreviewSrcDoc({
    content,
    convertFileSrc,
    filePath: path,
    vaultPath,
  }), [content, path, vaultPath])

  useEffect(() => {
    trackEvent('html_file_preview_opened')
  }, [])

  useEffect(() => {
    const releaseFocusedFrame = () => { releaseFrameFocus(frameRef.current, focusTargetRef.current); }
    window.addEventListener('blur', releaseFocusedFrame)
    return () => { window.removeEventListener('blur', releaseFocusedFrame); }
  }, [])

  return (
    <section
      className="min-h-0 flex-1 bg-background"
      data-note-pdf-export-root="true"
      role="application"
      aria-label={title}
    >
      <Button
        ref={focusTargetRef}
        type="button"
        className="sr-only"
        tabIndex={-1}
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          focusNoteListContainer(document)
        }}
      />
      <iframe
        ref={frameRef}
        className="h-full min-h-[320px] w-full border-0 bg-white"
        data-testid="html-file-preview"
        referrerPolicy="no-referrer"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        tabIndex={-1}
        title={title}
      />
    </section>
  )
}
