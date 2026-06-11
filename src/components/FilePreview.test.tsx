import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilePreview } from './FilePreview'
import type { VaultEntry } from '../types'

const { externalMediaPreviewMock, trackEventMock } = vi.hoisted(() => ({
  externalMediaPreviewMock: vi.fn(() => false),
  trackEventMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

vi.mock('../lib/telemetry', () => ({
  trackEvent: trackEventMock,
}))

vi.mock('../utils/mediaPreviewRuntime', () => ({
  useExternalMediaPreview: externalMediaPreviewMock,
}))

const imageEntry: VaultEntry = {
  path: '/vault/Attachments/photo.png',
  filename: 'photo.png',
  title: 'photo.png',
  isA: null,
  aliases: [],
  belongsTo: [],
  relatedTo: [],
  status: null,
  archived: false,
  modifiedAt: 1700000000,
  createdAt: 1700000000,
  fileSize: 100,
  snippet: '',
  wordCount: 0,
  relationships: {},
  icon: null,
  color: null,
  order: null,
  sidebarLabel: null,
  template: null,
  sort: null,
  view: null,
  visible: null,
  organized: false,
  favorite: false,
  favoriteIndex: null,
  listPropertiesDisplay: [],
  outgoingLinks: [],
  properties: {},
  hasH1: false,
  fileKind: 'binary',
}
const pdfEntry: VaultEntry = {
  ...imageEntry,
  path: '/vault/Attachments/report.pdf',
  filename: 'report.pdf',
  title: 'report.pdf',
}
const secondPdfEntry: VaultEntry = {
  ...imageEntry,
  path: '/vault/Attachments/brief.pdf',
  filename: 'brief.pdf',
  title: 'brief.pdf',
}
const audioEntry: VaultEntry = {
  ...imageEntry,
  path: '/vault/Attachments/meeting.mp3',
  filename: 'meeting.mp3',
  title: 'meeting.mp3',
}
const videoEntry: VaultEntry = {
  ...imageEntry,
  path: '/vault/Attachments/demo.mp4',
  filename: 'demo.mp4',
  title: 'demo.mp4',
}

describe('FilePreview', () => {
  beforeEach(() => {
    externalMediaPreviewMock.mockReturnValue(false)
    trackEventMock.mockClear()
  })

  it('routes header file actions to the active file path', () => {
    const onRevealFile = vi.fn()
    const onCopyFilePath = vi.fn()
    const onCopyDeepLink = vi.fn()
    const onOpenExternalFile = vi.fn()

    render(
      <FilePreview
        entry={imageEntry}
        onRevealFile={onRevealFile}
        onCopyFilePath={onCopyFilePath}
        onCopyDeepLink={onCopyDeepLink}
        onOpenExternalFile={onOpenExternalFile}
      />,
    )

    expect(trackEventMock).toHaveBeenCalledWith('file_preview_opened', { preview_kind: 'image' })

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(onRevealFile).toHaveBeenCalledWith('/vault/Attachments/photo.png')
    expect(onCopyFilePath).toHaveBeenCalledWith('/vault/Attachments/photo.png')
    expect(onCopyDeepLink).toHaveBeenCalledWith(imageEntry)
    expect(onOpenExternalFile).toHaveBeenCalledWith('/vault/Attachments/photo.png')
    expect(trackEventMock).toHaveBeenCalledWith('file_preview_action', {
      action: 'reveal',
      preview_kind: 'image',
    })
    expect(trackEventMock).toHaveBeenCalledWith('file_preview_action', {
      action: 'copy_path',
      preview_kind: 'image',
    })
    expect(trackEventMock).toHaveBeenCalledWith('file_preview_action', {
      action: 'copy_deep_link',
      preview_kind: 'image',
    })
    expect(trackEventMock).toHaveBeenCalledWith('file_preview_action', {
      action: 'open_external',
      preview_kind: 'image',
    })
  })

  it('renders supported PDF files through the asset preview path', () => {
    render(<FilePreview entry={pdfEntry} />)

    expect(screen.getByTestId('pdf-file-preview')).toHaveAttribute(
      'data',
      expect.stringMatching(/^asset:\/\/\/vault\/Attachments\/report\.pdf\?tolaria_pdf_preview=/u),
    )
    expect(screen.getByText('PDF file')).toBeInTheDocument()
  })

  it('renders supported PDFs when binary metadata is unavailable', () => {
    render(<FilePreview entry={{ ...pdfEntry, fileKind: undefined }} />)

    expect(screen.getByTestId('pdf-file-preview')).toHaveAttribute(
      'data',
      expect.stringMatching(/^asset:\/\/\/vault\/Attachments\/report\.pdf\?tolaria_pdf_preview=/u),
    )
  })

  it('uses a fresh PDF asset URL when reopening the same PDF after navigation', () => {
    const firstRender = render(<FilePreview entry={pdfEntry} />)
    const firstPdfSrc = firstRender.getByTestId('pdf-file-preview').getAttribute('data')

    firstRender.unmount()
    render(<FilePreview entry={pdfEntry} />)

    expect(screen.getByTestId('pdf-file-preview')).toHaveAttribute(
      'data',
      expect.stringMatching(/^asset:\/\/\/vault\/Attachments\/report\.pdf\?tolaria_pdf_preview=/u),
    )
    expect(screen.getByTestId('pdf-file-preview').getAttribute('data')).not.toBe(firstPdfSrc)
  })

  it('refreshes the PDF object URL when the preview remounts for a PDF file switch', () => {
    const renderPreview = (entry: VaultEntry) => <FilePreview key={entry.path} entry={entry} />
    const { rerender } = render(renderPreview(pdfEntry))
    const firstPdfSrc = screen.getByTestId('pdf-file-preview').getAttribute('data')

    rerender(renderPreview(secondPdfEntry))
    rerender(renderPreview(pdfEntry))

    expect(screen.getByTestId('pdf-file-preview').getAttribute('data')).not.toBe(firstPdfSrc)
  })

  it('renders supported audio files through the media asset path', () => {
    render(<FilePreview entry={audioEntry} />)

    expect(screen.getByTestId('audio-file-preview')).toHaveAttribute('src', 'asset:///vault/Attachments/meeting.mp3')
    expect(screen.getByText('MP3 file')).toBeInTheDocument()
    expect(trackEventMock).toHaveBeenCalledWith('file_preview_opened', { preview_kind: 'audio' })
  })

  it('renders supported video files through the media asset path', () => {
    render(<FilePreview entry={videoEntry} />)

    expect(screen.getByTestId('video-file-preview')).toHaveAttribute('src', 'asset:///vault/Attachments/demo.mp4')
    expect(screen.getByTestId('video-file-preview')).toHaveAttribute('title', 'demo.mp4')
    expect(trackEventMock).toHaveBeenCalledWith('file_preview_opened', { preview_kind: 'video' })
  })

  it('uses the external-open fallback for media when native playback is unsafe', () => {
    const onOpenExternalFile = vi.fn()
    externalMediaPreviewMock.mockReturnValue(true)

    render(<FilePreview entry={videoEntry} onOpenExternalFile={onOpenExternalFile} />)

    expect(screen.queryByTestId('video-file-preview')).not.toBeInTheDocument()
    expect(screen.getByTestId('file-preview-fallback')).toHaveTextContent('Preview unavailable')

    fireEvent.click(screen.getByRole('button', { name: 'Open in default app' }))
    expect(onOpenExternalFile).toHaveBeenCalledWith('/vault/Attachments/demo.mp4')
  })

  it('provides a graceful fallback when a PDF preview cannot render', () => {
    render(<FilePreview entry={pdfEntry} />)

    expect(screen.getByTestId('file-preview-fallback')).toHaveTextContent('PDF preview failed')
    expect(screen.getByRole('button', { name: 'Open in default app' })).toBeInTheDocument()
  })

  it('tracks image preview failures without leaking the file path', () => {
    render(<FilePreview entry={imageEntry} />)

    fireEvent.error(screen.getByTestId('image-file-preview'))

    expect(trackEventMock).toHaveBeenCalledWith('file_preview_failed', { preview_kind: 'image' })
    expect(trackEventMock).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ path: expect.any(String) }),
    )
  })

  it('tracks media preview failures without leaking the file path', () => {
    render(<FilePreview entry={audioEntry} />)

    fireEvent.error(screen.getByTestId('audio-file-preview'))

    expect(trackEventMock).toHaveBeenCalledWith('file_preview_failed', { preview_kind: 'audio' })
    expect(trackEventMock).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ path: expect.any(String) }),
    )
  })
})
