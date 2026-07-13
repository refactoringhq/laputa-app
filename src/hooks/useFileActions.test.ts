import { describe, expect, it } from 'vitest'
import { translate, type TranslationKey, type TranslationValues } from '../lib/i18n'
import { fileActionErrorMessage } from './useFileActions'

function localizedErrorPayload(key: TranslationKey, values: TranslationValues): string {
  return `tolaria:i18n-error:${JSON.stringify({ key, values })}`
}

describe('file action error messages', () => {
  it('localizes native reveal error payloads before formatting the toast', () => {
    const path = '/tmp/missing-note.md'
    const detail = translate('it-IT', 'fileActions.error.pathMissing', { path })
    const error = new Error(localizedErrorPayload('fileActions.error.pathMissing', { path }))

    expect(fileActionErrorMessage('it-IT', 'fileActions.error.revealPath', error)).toBe(
      translate('it-IT', 'fileActions.error.revealPath', { detail }),
    )
  })

  it('keeps plain command errors as the translated toast detail', () => {
    expect(fileActionErrorMessage('en', 'fileActions.error.copyPath', 'clipboard denied')).toBe(
      'Failed to copy path: clipboard denied',
    )
  })
})
