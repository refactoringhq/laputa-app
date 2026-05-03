import { describe, expect, it } from 'vitest'
import {
  APP_LOCALES,
  EN_TRANSLATIONS,
  localeCatalogLocales,
  localeDisplayName,
  normalizeUiLanguagePreference,
  resolveEffectiveLocale,
  serializeUiLanguagePreference,
  translate,
} from './i18n'

describe('i18n', () => {
  it('uses supported system languages before falling back to English', () => {
    expect(resolveEffectiveLocale(null, ['zh-CN'])).toBe('zh-CN')
    expect(resolveEffectiveLocale(null, ['zh-TW'])).toBe('zh-TW')
    expect(resolveEffectiveLocale(null, ['es-MX'])).toBe('es-419')
    expect(resolveEffectiveLocale('system', ['fr-FR'])).toBe('fr-FR')
    expect(resolveEffectiveLocale('system', ['xx-ZZ'])).toBe('en')
  })

  it('normalizes current and legacy language preferences', () => {
    expect(normalizeUiLanguagePreference(' zh-cn ')).toBe('zh-CN')
    expect(normalizeUiLanguagePreference('zh-Hans')).toBe('zh-CN')
    expect(normalizeUiLanguagePreference('zh-Hant')).toBe('zh-TW')
    expect(normalizeUiLanguagePreference('zh-HK')).toBe('zh-TW')
    expect(normalizeUiLanguagePreference('fr-FR')).toBe('fr-FR')
    expect(normalizeUiLanguagePreference('auto')).toBe('system')
    expect(normalizeUiLanguagePreference('xx-ZZ')).toBeNull()
  })

  it('serializes system preference as the settings default', () => {
    expect(serializeUiLanguagePreference('system')).toBeNull()
    expect(serializeUiLanguagePreference('zh-Hans')).toBe('zh-CN')
    expect(serializeUiLanguagePreference('zh-Hant')).toBe('zh-TW')
  })

  it('keeps English locale metadata aligned with the locale registry', () => {
    expect(APP_LOCALES).toContain('zh-CN')
    expect(APP_LOCALES).toContain('zh-TW')
    expect(APP_LOCALES).toContain('ko-KR')
    expect(localeDisplayName('pt-BR', 'en')).toBe('Portuguese (Brazil)')
  })

  it('formats locale display names in the active language', () => {
    expect(localeDisplayName('zh-CN', 'zh-CN')).toBe('简体中文')
    expect(localeDisplayName('zh-TW', 'zh-TW')).toBe('繁體中文')
    expect(localeDisplayName('en', 'zh-CN')).toBe('英文')
    expect(localeDisplayName('es-419', 'en')).toBe('Spanish (Latin America)')
  })

  it('keeps locale label keys present in English', () => {
    expect(EN_TRANSLATIONS['locale.itIT']).toBe('Italian')
    expect(EN_TRANSLATIONS['locale.koKR']).toBe('Korean')
  })

  it('loads a translation catalog for every configured locale', () => {
    expect(localeCatalogLocales()).toEqual(APP_LOCALES)
  })

  it('drops English-only plural suffix values for non-English locales', () => {
    expect(translate('en', 'status.conflict.count', { count: 2, plural: 's' })).toBe('2 conflicts')
    expect(translate('zh-CN', 'status.conflict.count', { count: 2, plural: 's' })).toBe('2 个冲突')
    expect(translate('zh-TW', 'status.conflict.count', { count: 2, plural: 's' })).toBe('2 個衝突')
  })
})
