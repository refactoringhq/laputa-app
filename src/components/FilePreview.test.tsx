import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FilePreview } from './FilePreview'
import type { VaultEntry } from '../types'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
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

describe('FilePreview', () => {
  it('routes header file actions to the active file path', () => {
    const onRevealFile = vi.fn()
    const onCopyFilePath = vi.fn()
    const onOpenExternalFile = vi.fn()

    render(
      <FilePreview
        entry={imageEntry}
        onRevealFile={onRevealFile}
        onCopyFilePath={onCopyFilePath}
        onOpenExternalFile={onOpenExternalFile}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(onRevealFile).toHaveBeenCalledWith('/vault/Attachments/photo.png')
    expect(onCopyFilePath).toHaveBeenCalledWith('/vault/Attachments/photo.png')
    expect(onOpenExternalFile).toHaveBeenCalledWith('/vault/Attachments/photo.png')
  })

  it('renders supported PDF files through the asset preview path', () => {
    render(<FilePreview entry={pdfEntry} />)

    expect(screen.getByTestId('pdf-file-preview')).toHaveAttribute('data', 'asset:///vault/Attachments/report.pdf')
    expect(screen.getByText('PDF file')).toBeInTheDocument()
  })

  it('renders supported PDFs when binary metadata is unavailable', () => {
    render(<FilePreview entry={{ ...pdfEntry, fileKind: undefined }} />)

    expect(screen.getByTestId('pdf-file-preview')).toHaveAttribute('data', 'asset:///vault/Attachments/report.pdf')
  })

  it('provides a graceful fallback when a PDF preview cannot render', () => {
    render(<FilePreview entry={pdfEntry} />)

    expect(screen.getByTestId('file-preview-fallback')).toHaveTextContent('PDF preview failed')
    expect(screen.getByRole('button', { name: 'Open in default app' })).toBeInTheDocument()
  })
})
