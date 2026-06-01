import {
  trackNotePdfExportFailed,
  trackNotePdfExportStarted,
} from '../lib/productAnalytics'
import { isTauri } from '../mock-tauri'

export const NOTE_PDF_EXPORT_CLASS = 'tolaria-note-pdf-exporting'

const DEFAULT_CLEANUP_DELAY_MS = 30_000
const PDF_EXTENSION = '.pdf'
const UNSAFE_FILENAME_CHARACTERS = '<>:"/\\|?*'

export type NotePdfExportSource = 'breadcrumb' | 'app_command' | 'note_list_context_menu'
export type NotePdfExportFailureReason = 'export_unavailable' | 'export_error'

export class NotePdfExportUnavailableError extends Error {
  constructor() {
    super('PDF export is not available in this window.')
    this.name = 'NotePdfExportUnavailableError'
  }
}

interface NotePdfExportOptions {
  canSaveNativePdf?: () => Promise<boolean>
  cleanupDelayMs?: number
  defaultFilename?: string
  documentObject?: Document
  nativePrint?: () => Promise<void>
  nativeSavePdf?: (outputPath: string) => Promise<void>
  print?: () => void | Promise<void>
  saveDialog?: (defaultFilename: string) => Promise<string | null>
  source: NotePdfExportSource
  windowObject?: Window
}

type ResolvedPdfExport = {
  cleanupAfterRun: boolean
  run: () => void | Promise<void>
}
type PdfExportResolution = ResolvedPdfExport | 'cancelled' | null

function waitForPrintStyles(windowObject: Window): Promise<void> {
  return new Promise((resolve) => {
    windowObject.requestAnimationFrame(() => {
      windowObject.requestAnimationFrame(() => resolve())
    })
  })
}

export function cleanupNotePdfExportPrintMode(documentObject: Document = document): void {
  documentObject.body?.classList.remove(NOTE_PDF_EXPORT_CLASS)
}

function schedulePrintModeCleanup(
  documentObject: Document,
  windowObject: Window,
  cleanupDelayMs: number,
): () => void {
  let cleaned = false
  let timeoutId: number | null = null

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    cleanupNotePdfExportPrintMode(documentObject)
    windowObject.removeEventListener('afterprint', cleanup)
    if (timeoutId !== null) windowObject.clearTimeout(timeoutId)
  }

  windowObject.addEventListener('afterprint', cleanup)
  timeoutId = windowObject.setTimeout(cleanup, cleanupDelayMs)
  return cleanup
}

function resolvePrintFunction(
  windowObject: Window,
  {
    print,
  }: Pick<NotePdfExportOptions, 'print'>,
): PdfExportResolution {
  if (print) return { cleanupAfterRun: false, run: print }
  return typeof windowObject.print === 'function'
    ? { cleanupAfterRun: false, run: () => windowObject.print() }
    : null
}

function ensurePdfExtension(path: string): string {
  return path.toLowerCase().endsWith(PDF_EXTENSION) ? path : `${path}${PDF_EXTENSION}`
}

function stripMarkdownExtension(filename: string): string {
  return filename.replace(/\.(md|markdown)$/i, '')
}

function sanitizeFilenameStem(filename: string): string {
  return Array.from(filename, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint < 32 || UNSAFE_FILENAME_CHARACTERS.includes(character) ? '-' : character
  }).join('')
}

export function notePdfExportFilename(filename = 'Untitled Note'): string {
  const stem = sanitizeFilenameStem(stripMarkdownExtension(filename)).trim()
  return `${stem || 'Untitled Note'}${PDF_EXTENSION}`
}

async function openPdfSaveDialog(defaultFilename: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const outputPath = await save({
    defaultPath: defaultFilename,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  return typeof outputPath === 'string' ? ensurePdfExtension(outputPath) : null
}

async function saveCurrentNativeWebviewPdf(outputPath: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('export_current_webview_pdf', { outputPath })
}

async function canSaveCurrentNativeWebviewPdf(): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<boolean>('can_export_current_webview_pdf')
}

async function printCurrentNativeWebview(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('print_current_webview')
}

async function resolveNativePdfExport({
  canSaveNativePdf = canSaveCurrentNativeWebviewPdf,
  defaultFilename = notePdfExportFilename(),
  nativePrint = printCurrentNativeWebview,
  nativeSavePdf = saveCurrentNativeWebviewPdf,
  saveDialog = openPdfSaveDialog,
}: Pick<
  NotePdfExportOptions,
  'canSaveNativePdf' | 'defaultFilename' | 'nativePrint' | 'nativeSavePdf' | 'saveDialog'
>): Promise<PdfExportResolution> {
  if (!await canSaveNativePdf()) {
    return { cleanupAfterRun: false, run: nativePrint }
  }

  const outputPath = await saveDialog(defaultFilename)
  if (!outputPath) return 'cancelled'

  return {
    cleanupAfterRun: false,
    run: () => nativeSavePdf(outputPath),
  }
}

async function resolvePdfExport(
  windowObject: Window,
  options: Pick<
    NotePdfExportOptions,
    'canSaveNativePdf' | 'defaultFilename' | 'nativePrint' | 'nativeSavePdf' | 'print' | 'saveDialog'
  >,
): Promise<PdfExportResolution> {
  if (isTauri()) return resolveNativePdfExport(options)
  return resolvePrintFunction(windowObject, options)
}

export async function printActiveNoteAsPdf({
  cleanupDelayMs = DEFAULT_CLEANUP_DELAY_MS,
  canSaveNativePdf,
  defaultFilename,
  documentObject = document,
  nativePrint,
  nativeSavePdf,
  print,
  saveDialog,
  source,
  windowObject = window,
}: NotePdfExportOptions): Promise<void> {
  const exportDocument = await resolvePdfExport(windowObject, {
    canSaveNativePdf,
    defaultFilename,
    nativePrint,
    nativeSavePdf,
    print,
    saveDialog,
  })
  if (exportDocument === 'cancelled') return
  if (!exportDocument) {
    trackNotePdfExportFailed(source, 'export_unavailable')
    throw new NotePdfExportUnavailableError()
  }

  trackNotePdfExportStarted(source)
  documentObject.body.classList.add(NOTE_PDF_EXPORT_CLASS)
  const cleanup = schedulePrintModeCleanup(documentObject, windowObject, cleanupDelayMs)

  try {
    await waitForPrintStyles(windowObject)
    await exportDocument.run()
    if (exportDocument.cleanupAfterRun) cleanup()
  } catch (error) {
    cleanup()
    trackNotePdfExportFailed(source, 'export_error')
    throw error
  }
}
