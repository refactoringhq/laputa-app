import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOTE_PDF_EXPORT_CLASS,
  cleanupNotePdfExportPrintMode,
  notePdfExportFilename,
  printActiveNoteAsPdf,
} from './notePdfExport'
import {
  trackNotePdfExportFailed,
  trackNotePdfExportStarted,
} from '../lib/productAnalytics'

const tauriRuntimeMock = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
}))

vi.mock('../mock-tauri', () => ({
  isTauri: tauriRuntimeMock.isTauri,
}))

vi.mock('../lib/productAnalytics', () => ({
  trackNotePdfExportFailed: vi.fn(),
  trackNotePdfExportStarted: vi.fn(),
}))

let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  tauriRuntimeMock.isTauri.mockReturnValue(false)
  requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return 1
  })
})

afterEach(() => {
  cleanupNotePdfExportPrintMode()
  vi.clearAllMocks()
  requestAnimationFrameSpy.mockRestore()
})

describe('note PDF export', () => {
  it('enables print-only mode before opening the browser print dialog', async () => {
    const print = vi.fn()

    await printActiveNoteAsPdf({ print, source: 'breadcrumb' })

    expect(document.body).toHaveClass(NOTE_PDF_EXPORT_CLASS)
    expect(print).toHaveBeenCalledOnce()
    expect(trackNotePdfExportStarted).toHaveBeenCalledWith('breadcrumb')
  })

  it('saves the current native webview to a chosen PDF path inside Tauri', async () => {
    tauriRuntimeMock.isTauri.mockReturnValue(true)
    const nativeSavePdf = vi.fn().mockResolvedValue(undefined)

    await printActiveNoteAsPdf({
      canSaveNativePdf: vi.fn().mockResolvedValue(true),
      defaultFilename: 'Project Plan.pdf',
      nativeSavePdf,
      saveDialog: vi.fn().mockResolvedValue('/tmp/project-plan.pdf'),
      source: 'app_command',
    })

    expect(nativeSavePdf).toHaveBeenCalledWith('/tmp/project-plan.pdf')
    expect(trackNotePdfExportStarted).toHaveBeenCalledWith('app_command')
    expect(document.body).toHaveClass(NOTE_PDF_EXPORT_CLASS)

    window.dispatchEvent(new Event('afterprint'))
    expect(document.body).not.toHaveClass(NOTE_PDF_EXPORT_CLASS)
  })

  it('does nothing when the native save dialog is cancelled', async () => {
    tauriRuntimeMock.isTauri.mockReturnValue(true)
    const nativeSavePdf = vi.fn()

    await printActiveNoteAsPdf({
      canSaveNativePdf: vi.fn().mockResolvedValue(true),
      nativeSavePdf,
      saveDialog: vi.fn().mockResolvedValue(null),
      source: 'breadcrumb',
    })

    expect(nativeSavePdf).not.toHaveBeenCalled()
    expect(trackNotePdfExportStarted).not.toHaveBeenCalled()
  })

  it('falls back to the native print dialog when direct PDF saving is unsupported', async () => {
    tauriRuntimeMock.isTauri.mockReturnValue(true)
    const nativePrint = vi.fn().mockResolvedValue(undefined)
    const nativeSavePdf = vi.fn()
    const saveDialog = vi.fn()

    await printActiveNoteAsPdf({
      canSaveNativePdf: vi.fn().mockResolvedValue(false),
      nativePrint,
      nativeSavePdf,
      saveDialog,
      source: 'app_command',
    })

    expect(nativePrint).toHaveBeenCalledOnce()
    expect(nativeSavePdf).not.toHaveBeenCalled()
    expect(saveDialog).not.toHaveBeenCalled()
    expect(trackNotePdfExportStarted).toHaveBeenCalledWith('app_command')
  })

  it('removes print-only mode after the native print lifecycle finishes', async () => {
    await printActiveNoteAsPdf({ print: vi.fn(), source: 'app_command' })

    window.dispatchEvent(new Event('afterprint'))

    expect(document.body).not.toHaveClass(NOTE_PDF_EXPORT_CLASS)
  })

  it('tracks and cleans up failed print attempts', async () => {
    const error = new Error('print failed')

    await expect(printActiveNoteAsPdf({
      print: () => { throw error },
      source: 'app_command',
    })).rejects.toThrow(error)

    expect(document.body).not.toHaveClass(NOTE_PDF_EXPORT_CLASS)
    expect(trackNotePdfExportFailed).toHaveBeenCalledWith('app_command', 'export_error')
  })

  it('builds safe default PDF filenames from markdown filenames', () => {
    expect(notePdfExportFilename('Project Plan.md')).toBe('Project Plan.pdf')
    expect(notePdfExportFilename('unsafe:/name.markdown')).toBe('unsafe--name.pdf')
  })
})
