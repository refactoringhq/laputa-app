import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { ArrowSquareOut, ClipboardText, FileDashed, FilePdf, FolderOpen, ImageSquare, Link, SpeakerHigh, Video, WarningCircle } from '@phosphor-icons/react'
import type { VaultEntry } from '../types'
import { translate, type AppLocale } from '../lib/i18n'
import { trackFilePreviewAction, trackFilePreviewFailed, trackFilePreviewOpened } from '../lib/productAnalytics'
import { filePreviewKind, previewFileTypeLabel, type FilePreviewKind } from '../utils/filePreview'
import { useExternalMediaPreview } from '../utils/mediaPreviewRuntime'
import { focusNoteListContainer } from '../utils/neighborhoodHistory'
import { openLocalFile } from '../utils/url'
import { Button } from './ui/button'

interface FilePreviewProps {
  entry: VaultEntry
  locale?: AppLocale
  onCopyFilePath?: (path: string) => void
  onCopyDeepLink?: (entry: VaultEntry) => void
  onOpenExternalFile?: (path: string) => void
  onRevealFile?: (path: string) => void
}

interface FilePreviewFallbackProps {
  icon: 'warning' | 'file'
  title: string
  description: string
  canOpenExternal?: boolean
  onOpenExternal: () => void
}

interface FilePreviewState {
  canUseFileActions: boolean
  previewKind: FilePreviewKind | null
  previewPath: string | null
}

const EMPTY_CAPTIONS_TRACK = 'data:text/vtt,WEBVTT'
let pdfPreviewLoadSequence = 0

function nextPdfPreviewLoadKey(): string {
  pdfPreviewLoadSequence += 1
  return String(pdfPreviewLoadSequence)
}

function appendPdfPreviewLoadKey(assetSrc: string, loadKey: string): string {
  const hashIndex = assetSrc.indexOf('#')
  const baseSrc = hashIndex === -1 ? assetSrc : assetSrc.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : assetSrc.slice(hashIndex)
  const separator = baseSrc.includes('?') ? '&' : '?'
  return `${baseSrc}${separator}tolaria_pdf_preview=${encodeURIComponent(loadKey)}${hash}`
}

function filePreviewPath(path: unknown): string | null {
  if (typeof path !== 'string') return null
  return path.trim().length > 0 ? path : null
}

function filePreviewState(entry: VaultEntry): FilePreviewState {
  const previewPath = filePreviewPath(entry.path)
  if (previewPath === null) {
    return { canUseFileActions: false, previewKind: null, previewPath }
  }

  const previewEntry = previewPath === entry.path ? entry : { ...entry, path: previewPath }
  return {
    canUseFileActions: true,
    previewKind: filePreviewKind(previewEntry),
    previewPath,
  }
}

function filePreviewAssetSrc(previewKind: FilePreviewKind | null, previewPath: string | null, pdfPreviewLoadKey: string): string | null {
  if (!previewKind || previewPath === null) return null

  let src: string
  try {
    src = convertFileSrc(previewPath)
  } catch (error) {
    console.warn('[file-preview] Failed to prepare asset preview source:', error)
    return null
  }

  return previewKind === 'pdf' ? appendPdfPreviewLoadKey(src, pdfPreviewLoadKey) : src
}

function usePdfPreviewLoadKey(): string {
  const [loadKey] = useState(nextPdfPreviewLoadKey)
  return loadKey
}

function fallbackContentForPreviewKind(previewKind: FilePreviewKind | null): Omit<FilePreviewFallbackProps, 'onOpenExternal'> {
  if (previewKind === 'image') {
    return {
      icon: 'warning',
      title: 'Image preview failed',
      description: 'Tolaria could not render this image file in the preview.',
    }
  }

  if (previewKind === 'pdf') {
    return {
      icon: 'warning',
      title: 'PDF preview failed',
      description: 'Tolaria could not render this PDF file in the preview.',
    }
  }

  return {
    icon: 'file',
    title: 'Preview unavailable',
    description: 'Tolaria does not have an in-app preview for this file type.',
  }
}

function FilePreviewHeaderIcon({ previewKind }: { previewKind: FilePreviewKind | null }) {
  if (previewKind === 'image') {
    return <ImageSquare size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />
  }

  if (previewKind === 'pdf') {
    return <FilePdf size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />
  }

  if (previewKind === 'audio') {
    return <SpeakerHigh size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />
  }

  if (previewKind === 'video') {
    return <Video size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />
  }

  return <FileDashed size={17} className="shrink-0 text-muted-foreground" aria-hidden="true" />
}

function FilePreviewFallback({ icon, title, description, canOpenExternal = true, onOpenExternal }: FilePreviewFallbackProps) {
  const Icon = icon === 'warning' ? WarningCircle : FileDashed

  return (
    <div
      className="flex h-full min-h-[260px] flex-col items-center justify-center gap-4 px-8 text-center"
      data-testid="file-preview-fallback"
    >
      <Icon size={34} className="text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <h2 className="m-0 text-[15px] font-semibold text-foreground">{title}</h2>
        <p className="m-0 max-w-md text-[13px] leading-6 text-muted-foreground">{description}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onOpenExternal} disabled={!canOpenExternal}>
        <ArrowSquareOut size={15} />
        Open in default app
      </Button>
    </div>
  )
}

function FilePreviewHeader({
  entry,
  previewKind,
  canUseFileActions,
  fileTypeLabel,
  locale = 'en',
  onOpenExternal,
  onRevealFile,
  onCopyFilePath,
  onCopyDeepLink,
}: {
  entry: VaultEntry
  previewKind: FilePreviewKind | null
  canUseFileActions: boolean
  fileTypeLabel: string
  locale?: AppLocale
  onOpenExternal: () => void
  onRevealFile?: () => void
  onCopyFilePath?: () => void
  onCopyDeepLink?: () => void
}) {
  return (
    <div
      className="flex h-[52px] shrink-0 items-center justify-between border-b border-border px-4"
      data-tauri-drag-region
    >
      <div className="flex min-w-0 items-center gap-2">
        <FilePreviewHeaderIcon previewKind={previewKind} />
        <div className="min-w-0">
          <h1 className="m-0 truncate text-[14px] font-semibold text-foreground">{entry.title}</h1>
          <p className="m-0 text-[11px] text-muted-foreground">{fileTypeLabel}</p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onRevealFile && (
          <Button type="button" variant="ghost" size="sm" onClick={onRevealFile} disabled={!canUseFileActions}>
            <FolderOpen size={15} />
            Reveal
          </Button>
        )}
        {onCopyFilePath && (
          <Button type="button" variant="ghost" size="sm" onClick={onCopyFilePath} disabled={!canUseFileActions}>
            <ClipboardText size={15} />
            Copy path
          </Button>
        )}
        {onCopyDeepLink && (
          <Button type="button" variant="ghost" size="sm" onClick={onCopyDeepLink} disabled={!canUseFileActions}>
            <Link size={15} />
            {translate(locale, 'filePreview.copyDeepLink')}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onOpenExternal} disabled={!canUseFileActions}>
          <ArrowSquareOut size={15} />
          Open
        </Button>
      </div>
    </div>
  )
}

function FilePreviewPdf({
  entry,
  pdfSrc,
  onOpenExternal,
}: {
  entry: VaultEntry
  pdfSrc: string
  onOpenExternal: () => void
}) {
  const fallback = fallbackContentForPreviewKind('pdf')

  return (
    <object
      key={pdfSrc}
      data={pdfSrc}
      type="application/pdf"
      title={entry.title}
      className="h-full min-h-[320px] w-full bg-background"
      data-testid="pdf-file-preview"
    >
      <FilePreviewFallback
        icon={fallback.icon}
        title={fallback.title}
        description={fallback.description}
        onOpenExternal={onOpenExternal}
      />
    </object>
  )
}

function FilePreviewImage({
  entry,
  imageSrc,
  onImageError,
}: {
  entry: VaultEntry
  imageSrc: string
  onImageError: () => void
}) {
  return (
    <div className="flex h-full min-h-[260px] items-center justify-center p-6">
      <img
        src={imageSrc}
        alt={entry.title}
        className="max-h-full max-w-full object-contain"
        data-testid="image-file-preview"
        onError={onImageError}
      />
    </div>
  )
}

function FilePreviewMediaFrame({
  children,
  video = false,
}: {
  children: ReactNode
  video?: boolean
}) {
  return (
    <div className={`flex h-full items-center justify-center ${video ? 'min-h-[320px] bg-black p-4' : 'min-h-[260px] p-6'}`}>
      {children}
    </div>
  )
}

function FilePreviewMedia({
  entry,
  mediaKind,
  mediaSrc,
  onMediaError,
}: {
  entry: VaultEntry
  mediaKind: 'audio' | 'video'
  mediaSrc: string
  onMediaError: () => void
}) {
  if (mediaKind === 'audio') {
    return (
      <FilePreviewMediaFrame>
        <audio
          controls
          preload="metadata"
          src={mediaSrc}
          className="w-full max-w-2xl"
          data-testid="audio-file-preview"
          onError={onMediaError}
        >
          <track kind="captions" src={EMPTY_CAPTIONS_TRACK} srcLang="en" label="No captions available" default />
        </audio>
      </FilePreviewMediaFrame>
    )
  }

  return (
    <FilePreviewMediaFrame video>
        <video
          controls
          preload="metadata"
          src={mediaSrc}
          title={entry.title}
          className="max-h-full max-w-full"
          data-testid="video-file-preview"
          onError={onMediaError}
        >
          <track kind="captions" src={EMPTY_CAPTIONS_TRACK} srcLang="en" label="No captions available" default />
        </video>
    </FilePreviewMediaFrame>
  )
}

function shouldRenderImagePreview(isImage: boolean, imageSrc: string | null, imageFailed: boolean): imageSrc is string {
  return isImage && imageSrc !== null && !imageFailed
}

function FilePreviewBody({
  entry,
  previewKind,
  assetSrc,
  imageFailed,
  canOpenExternal,
  onImageError,
  onAudioError,
  onVideoError,
  onOpenExternal,
}: {
  entry: VaultEntry
  previewKind: FilePreviewKind | null
  assetSrc: string | null
  imageFailed: boolean
  canOpenExternal: boolean
  onImageError: () => void
  onAudioError: () => void
  onVideoError: () => void
  onOpenExternal: () => void
}) {
  if (shouldRenderImagePreview(previewKind === 'image', assetSrc, imageFailed)) {
    return <FilePreviewImage entry={entry} imageSrc={assetSrc} onImageError={onImageError} />
  }

  if (previewKind === 'pdf' && assetSrc !== null) {
    return <FilePreviewPdf entry={entry} pdfSrc={assetSrc} onOpenExternal={onOpenExternal} />
  }

  if (previewKind === 'audio' && assetSrc !== null) {
    return <FilePreviewMedia entry={entry} mediaKind="audio" mediaSrc={assetSrc} onMediaError={onAudioError} />
  }

  if (previewKind === 'video' && assetSrc !== null) {
    return <FilePreviewMedia entry={entry} mediaKind="video" mediaSrc={assetSrc} onMediaError={onVideoError} />
  }

  const fallback = fallbackContentForPreviewKind(previewKind)

  return (
    <FilePreviewFallback
      icon={fallback.icon}
      title={fallback.title}
      description={fallback.description}
      canOpenExternal={canOpenExternal}
      onOpenExternal={onOpenExternal}
    />
  )
}

function useFilePreviewFailureState(entryPath: string) {
  const [failedImagePath, setFailedImagePath] = useState<string | null>(null)
  const [failedMediaPath, setFailedMediaPath] = useState<string | null>(null)

  const handleImageError = useCallback(() => {
    setFailedImagePath(entryPath)
    trackFilePreviewFailed('image')
  }, [entryPath])
  const handleAudioError = useCallback(() => {
    setFailedMediaPath(entryPath)
    trackFilePreviewFailed('audio')
  }, [entryPath])
  const handleVideoError = useCallback(() => {
    setFailedMediaPath(entryPath)
    trackFilePreviewFailed('video')
  }, [entryPath])

  return {
    imageFailed: failedImagePath === entryPath,
    mediaFailed: failedMediaPath === entryPath,
    handleImageError,
    handleAudioError,
    handleVideoError,
  }
}

function useFilePreviewActions({
  entry,
  entryPath,
  onCopyFilePath,
  onCopyDeepLink,
  onOpenExternalFile,
  onRevealFile,
  previewKind,
}: {
  entry: VaultEntry
  entryPath: string
  onCopyFilePath?: (path: string) => void
  onCopyDeepLink?: (entry: VaultEntry) => void
  onOpenExternalFile?: (path: string) => void
  onRevealFile?: (path: string) => void
  previewKind: FilePreviewKind | null
}) {
  const handleOpenExternal = useCallback(() => {
    trackFilePreviewAction('open_external', previewKind)
    if (onOpenExternalFile) {
      onOpenExternalFile(entryPath)
      return
    }

    void openLocalFile(entryPath).catch((error) => {
      console.warn('Failed to open file with default app:', error)
    })
  }, [entryPath, onOpenExternalFile, previewKind])

  const handleRevealFile = useCallback(() => {
    trackFilePreviewAction('reveal', previewKind)
    onRevealFile?.(entryPath)
  }, [entryPath, onRevealFile, previewKind])

  const handleCopyFilePath = useCallback(() => {
    trackFilePreviewAction('copy_path', previewKind)
    onCopyFilePath?.(entryPath)
  }, [entryPath, onCopyFilePath, previewKind])

  const handleCopyDeepLink = useCallback(() => {
    trackFilePreviewAction('copy_deep_link', previewKind)
    onCopyDeepLink?.(entry)
  }, [entry, onCopyDeepLink, previewKind])

  return { handleOpenExternal, handleRevealFile, handleCopyFilePath, handleCopyDeepLink }
}

function isMediaPreviewKind(previewKind: FilePreviewKind | null): boolean {
  return previewKind === 'audio' || previewKind === 'video'
}

function previewKindForBody(
  previewKind: FilePreviewKind | null,
  mediaFailed: boolean,
  externalMediaPreview: boolean,
): FilePreviewKind | null {
  if (mediaFailed || (externalMediaPreview && isMediaPreviewKind(previewKind))) return null
  return previewKind
}

export function FilePreview({
  entry,
  locale = 'en',
  onCopyFilePath,
  onCopyDeepLink,
  onOpenExternalFile,
  onRevealFile,
}: FilePreviewProps) {
  const previewRef = useRef<HTMLElement | null>(null)
  const { canUseFileActions, previewKind, previewPath } = filePreviewState(entry)
  const pdfPreviewLoadKey = usePdfPreviewLoadKey()
  const assetSrc = useMemo(() => {
    return filePreviewAssetSrc(previewKind, previewPath, pdfPreviewLoadKey)
  }, [pdfPreviewLoadKey, previewKind, previewPath])
  const fileTypeLabel = previewFileTypeLabel(entry)
  const externalMediaPreview = useExternalMediaPreview()
  const failures = useFilePreviewFailureState(previewPath ?? '')
  const actions = useFilePreviewActions({
    entry,
    entryPath: previewPath ?? '',
    onCopyFilePath,
    onCopyDeepLink,
    onOpenExternalFile,
    onRevealFile,
    previewKind,
  })

  useEffect(() => {
    void previewPath
    trackFilePreviewOpened(previewKind)
  }, [previewPath, previewKind])

  useEffect(() => {
    previewRef.current?.setAttribute('tabindex', '0')
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      focusNoteListContainer(document)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <section
      ref={previewRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
      data-testid="file-preview"
      aria-label={`Preview ${entry.title}`}
    >
      <FilePreviewHeader
        entry={entry}
        previewKind={previewKind}
        canUseFileActions={canUseFileActions}
        fileTypeLabel={fileTypeLabel}
        locale={locale}
        onOpenExternal={actions.handleOpenExternal}
        onRevealFile={onRevealFile ? actions.handleRevealFile : undefined}
        onCopyFilePath={onCopyFilePath ? actions.handleCopyFilePath : undefined}
        onCopyDeepLink={onCopyDeepLink ? actions.handleCopyDeepLink : undefined}
      />
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <FilePreviewBody
          entry={entry}
          previewKind={previewKindForBody(previewKind, failures.mediaFailed, externalMediaPreview)}
          assetSrc={assetSrc}
          imageFailed={failures.imageFailed}
          canOpenExternal={canUseFileActions}
          onImageError={failures.handleImageError}
          onAudioError={failures.handleAudioError}
          onVideoError={failures.handleVideoError}
          onOpenExternal={actions.handleOpenExternal}
        />
      </div>
    </section>
  )
}
