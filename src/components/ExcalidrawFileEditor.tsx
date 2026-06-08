import { Suspense, lazy, useEffect, useMemo } from 'react'
import { translate, type AppLocale } from '../lib/i18n'
import { trackExcalidrawOpened } from '../utils/excalidrawTelemetry'

const ExcalidrawCanvas = lazy(() => import('./ExcalidrawCanvas').then((module) => ({
  default: module.ExcalidrawCanvas,
})))

export interface ExcalidrawFileEditorProps {
  path: string
  content: string
  onContentChange: (next: string) => void
  locale?: AppLocale
}

function isExcalidrawScene(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const type = (value as Record<string, unknown>).type
  return type === 'excalidraw' || type === 'excalidraw/clipboard'
}

function validateContent(content: string): { valid: true } | { valid: false; reason: 'parse' | 'shape' } {
  if (!content.trim()) return { valid: true }

  try {
    const parsed = JSON.parse(content) as unknown
    if (!isExcalidrawScene(parsed)) return { valid: false, reason: 'shape' }
    return { valid: true }
  } catch {
    return { valid: false, reason: 'parse' }
  }
}

function filenameFromPath(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path
}

export function ExcalidrawFileEditor({ path, content, onContentChange, locale = 'en' }: ExcalidrawFileEditorProps) {
  const validation = useMemo(() => validateContent(content), [content])
  const boardId = useMemo(() => filenameFromPath(path), [path])

  useEffect(() => {
    trackExcalidrawOpened('file')
  }, [])

  if (!validation.valid) {
    const messageKey = validation.reason === 'parse'
      ? 'excalidrawFileEditor.invalidJson'
      : 'excalidrawFileEditor.invalidScene'

    return (
      <section
        className="excalidraw-file-editor excalidraw-file-editor--fallback flex flex-col min-h-0 flex-1"
        role="alert"
        aria-label={translate(locale, 'excalidrawFileEditor.label')}
      >
        <div className="excalidraw-file-editor__banner border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {translate(locale, messageKey)}
        </div>
        <pre
          className="excalidraw-file-editor__raw flex-1 overflow-auto bg-muted/30 px-4 py-3 font-mono text-xs"
          data-testid="excalidraw-file-editor-raw"
        >
          {content}
        </pre>
      </section>
    )
  }

  return (
    <section
      className="excalidraw-file-editor flex flex-col min-h-0 flex-1"
      aria-label={translate(locale, 'excalidrawFileEditor.label')}
    >
      <Suspense
        fallback={<div className="excalidraw-file-editor__loading flex-1" aria-busy="true" />}
      >
        <ExcalidrawCanvas
          key={path}
          boardId={boardId}
          fillParent
          height=""
          width=""
          snapshot={content}
          onSnapshotChange={onContentChange}
        />
      </Suspense>
    </section>
  )
}
