import { beforeEach, describe, expect, it, vi } from 'vitest'
import { convertPdfToMarkdownNote } from './pdfMarkdownImport'

const tauriRuntimeMock = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
  mockInvoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriRuntimeMock.invoke,
}))

vi.mock('../mock-tauri', () => ({
  isTauri: tauriRuntimeMock.isTauri,
  mockInvoke: tauriRuntimeMock.mockInvoke,
}))

beforeEach(() => {
  tauriRuntimeMock.invoke.mockReset()
  tauriRuntimeMock.isTauri.mockReturnValue(false)
  tauriRuntimeMock.mockInvoke.mockReset()
})

describe('convertPdfToMarkdownNote', () => {
  it('routes native imports through the Tauri command with normalized args', async () => {
    tauriRuntimeMock.isTauri.mockReturnValue(true)
    tauriRuntimeMock.invoke.mockResolvedValue({
      note_path: '/vault/Project.md',
      note_title: 'Project',
      ocr_available: true,
      page_count: 2,
      pages_ocr: 1,
      pages_text_extracted: 1,
      text_length: 120,
    })

    await convertPdfToMarkdownNote({
      ocrLanguage: ' eng ',
      ocrMode: 'ocr_when_needed',
      pdfPath: '/vault/Project.pdf',
      vaultPath: '/vault',
    })

    expect(tauriRuntimeMock.invoke).toHaveBeenCalledWith('convert_pdf_to_markdown_note', {
      ocrLanguage: 'eng',
      ocrMode: 'ocr_when_needed',
      pdfPath: '/vault/Project.pdf',
      vaultPath: '/vault',
    })
    expect(tauriRuntimeMock.mockInvoke).not.toHaveBeenCalled()
  })

  it('uses the browser mock command and omits empty optional args', async () => {
    tauriRuntimeMock.mockInvoke.mockResolvedValue({
      note_path: '/mock/Scan.md',
      note_title: 'Scan',
      ocr_available: false,
      page_count: null,
      pages_ocr: 0,
      pages_text_extracted: 1,
      text_length: 80,
    })

    await convertPdfToMarkdownNote({
      ocrLanguage: '   ',
      ocrMode: 'text_only',
      pdfPath: '/mock/Scan.pdf',
      vaultPath: null,
    })

    expect(tauriRuntimeMock.mockInvoke).toHaveBeenCalledWith('convert_pdf_to_markdown_note', {
      ocrLanguage: null,
      ocrMode: 'text_only',
      pdfPath: '/mock/Scan.pdf',
    })
    expect(tauriRuntimeMock.invoke).not.toHaveBeenCalled()
  })
})
