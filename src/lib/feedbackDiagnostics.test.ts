import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetFeedbackDiagnosticsForTest,
  buildSanitizedDiagnosticBundle,
  startFeedbackDiagnosticsCapture,
} from './feedbackDiagnostics'

describe('feedbackDiagnostics', () => {
  beforeEach(() => {
    __resetFeedbackDiagnosticsForTest()
  })

  it('sanitizes recent warnings and errors before building the bundle', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stopCapture = startFeedbackDiagnosticsCapture()
    const sampleToken = ['ghp', 'super-secret-token'].join('_')

    console.error(`Load failed for /Users/luca/Laputa/private.md with token ${sampleToken}`)
    console.warn('Retrying from C:\\Users\\luca\\Notes\\vault.md')

    const bundle = buildSanitizedDiagnosticBundle({
      buildNumber: 'b281',
      releaseChannel: 'alpha',
    })

    expect(bundle).toContain('Tolaria sanitized diagnostics')
    expect(bundle).toContain('Build: b281')
    expect(bundle).toContain('Release channel: alpha')
    expect(bundle).toContain('[error] Load failed for [redacted-path] with token [redacted-token]')
    expect(bundle).toContain('[warn] Retrying from [redacted-path]')
    expect(bundle).not.toContain('/Users/luca/Laputa/private.md')
    expect(bundle).not.toContain(sampleToken)
    expect(bundle).not.toContain('C:\\Users\\luca\\Notes\\vault.md')

    stopCapture()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('explains when no safe diagnostics were available', () => {
    const bundle = buildSanitizedDiagnosticBundle({
      buildNumber: undefined,
      releaseChannel: null,
    })

    expect(bundle).toContain('No safe recent diagnostics were available.')
  })
})
