import { invoke } from '@tauri-apps/api/core'
import { isTauri, mockInvoke } from '../mock-tauri'

export type PdfMarkdownOcrMode = 'text_only' | 'ocr_when_needed' | 'ocr_all_pages'
export type PdfMarkdownImportSource = 'file_preview' | 'note_list_context_menu' | 'app_command'

export interface PdfMarkdownImportRequest {
  ocrLanguage?: string | null
  ocrMode: PdfMarkdownOcrMode
  pdfPath: string
  vaultPath?: string | null
}

export interface PdfMarkdownImportResult {
  note_path: string
  note_title: string
  page_count: number | null
  pages_text_extracted: number
  pages_ocr: number
  ocr_available: boolean
  text_length: number
}

function importPdfArgs(request: PdfMarkdownImportRequest): Record<string, unknown> {
  return {
    pdfPath: request.pdfPath,
    ocrMode: request.ocrMode,
    ocrLanguage: request.ocrLanguage?.trim() || null,
    ...(request.vaultPath ? { vaultPath: request.vaultPath } : {}),
  }
}

export function convertPdfToMarkdownNote(
  request: PdfMarkdownImportRequest,
): Promise<PdfMarkdownImportResult> {
  const args = importPdfArgs(request)
  return isTauri()
    ? invoke<PdfMarkdownImportResult>('convert_pdf_to_markdown_note', args)
    : mockInvoke<PdfMarkdownImportResult>('convert_pdf_to_markdown_note', args)
}
