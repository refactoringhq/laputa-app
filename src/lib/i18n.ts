import EN_TRANSLATIONS from './locales/en.json'

export const DEFAULT_APP_LOCALE = 'en'
export const SYSTEM_UI_LANGUAGE = 'system'

export const APP_LOCALES = [
  'en',
  'it-IT',
  'fr-FR',
  'de-DE',
  'ru-RU',
  'es-ES',
  'pt-BR',
  'pt-PT',
  'es-419',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
] as const

export type AppLocale = typeof APP_LOCALES[number]
export type UiLanguagePreference = typeof SYSTEM_UI_LANGUAGE | AppLocale
export type TranslationCatalog = typeof EN_TRANSLATIONS
export type TranslationKey = keyof TranslationCatalog
export type TranslationValues = Record<string, string | number>

type LocaleDefinition = {
  code: AppLocale
  dateLocale: string
  labelKey: TranslationKey
  aliases: readonly string[]
  searchKeywords: readonly string[]
}

const LOCALE_DEFINITIONS: Record<AppLocale, LocaleDefinition> = {
  en: {
    code: 'en',
    dateLocale: 'en-US',
    labelKey: 'locale.en',
    aliases: ['en', 'en-us', 'en-gb', 'en-ca', 'en-au'],
    searchKeywords: ['english', 'en'],
  },
  'it-IT': {
    code: 'it-IT',
    dateLocale: 'it-IT',
    labelKey: 'locale.itIT',
    aliases: ['it', 'it-it'],
    searchKeywords: ['italian', 'italiano', 'it', 'it-it'],
  },
  'fr-FR': {
    code: 'fr-FR',
    dateLocale: 'fr-FR',
    labelKey: 'locale.frFR',
    aliases: ['fr', 'fr-fr'],
    searchKeywords: ['french', 'francais', 'français', 'fr', 'fr-fr'],
  },
  'de-DE': {
    code: 'de-DE',
    dateLocale: 'de-DE',
    labelKey: 'locale.deDE',
    aliases: ['de', 'de-de'],
    searchKeywords: ['german', 'deutsch', 'de', 'de-de'],
  },
  'ru-RU': {
    code: 'ru-RU',
    dateLocale: 'ru-RU',
    labelKey: 'locale.ruRU',
    aliases: ['ru', 'ru-ru'],
    searchKeywords: ['russian', 'russkiy', 'русский', 'ru', 'ru-ru'],
  },
  'es-ES': {
    code: 'es-ES',
    dateLocale: 'es-ES',
    labelKey: 'locale.esES',
    aliases: ['es-es'],
    searchKeywords: ['spanish', 'espanol', 'español', 'spain', 'es', 'es-es'],
  },
  'pt-BR': {
    code: 'pt-BR',
    dateLocale: 'pt-BR',
    labelKey: 'locale.ptBR',
    aliases: ['pt-br'],
    searchKeywords: ['portuguese', 'brasil', 'brazilian', 'pt', 'pt-br'],
  },
  'pt-PT': {
    code: 'pt-PT',
    dateLocale: 'pt-PT',
    labelKey: 'locale.ptPT',
    aliases: ['pt-pt'],
    searchKeywords: ['portuguese', 'portugal', 'european', 'pt-pt'],
  },
  'es-419': {
    code: 'es-419',
    dateLocale: 'es-419',
    labelKey: 'locale.es419',
    aliases: [
      'es-419',
      'es-ar',
      'es-bo',
      'es-cl',
      'es-co',
      'es-cr',
      'es-cu',
      'es-do',
      'es-ec',
      'es-gt',
      'es-hn',
      'es-mx',
      'es-ni',
      'es-pa',
      'es-pe',
      'es-pr',
      'es-py',
      'es-sv',
      'es-us',
      'es-uy',
      'es-ve',
    ],
    searchKeywords: ['spanish', 'latin', 'latam', 'latin america', 'es-419'],
  },
  'zh-CN': {
    code: 'zh-CN',
    dateLocale: 'zh-CN',
    labelKey: 'locale.zhCN',
    aliases: ['zh', 'zh-cn', 'zh-hans', 'zh-sg'],
    searchKeywords: ['chinese', 'simplified', 'zh', 'zh-cn', '中文', '简体中文'],
  },
  'zh-TW': {
    code: 'zh-TW',
    dateLocale: 'zh-TW',
    labelKey: 'locale.zhTW',
    aliases: ['zh-tw', 'zh-hant', 'zh-hk', 'zh-mo'],
    searchKeywords: ['chinese', 'traditional', 'zh-tw', 'zh-hant', '中文', '繁體中文', '繁体中文'],
  },
  'ja-JP': {
    code: 'ja-JP',
    dateLocale: 'ja-JP',
    labelKey: 'locale.jaJP',
    aliases: ['ja', 'ja-jp'],
    searchKeywords: ['japanese', 'nihongo', '日本語', 'ja', 'ja-jp'],
  },
  'ko-KR': {
    code: 'ko-KR',
    dateLocale: 'ko-KR',
    labelKey: 'locale.koKR',
    aliases: ['ko', 'ko-kr'],
    searchKeywords: ['korean', 'hangul', '한국어', 'ko', 'ko-kr'],
  },
}

const APP_LOCALE_SET = new Set<AppLocale>(APP_LOCALES)
const NORMALIZED_LOCALE_LOOKUP = new Map<string, AppLocale>()
for (const locale of APP_LOCALES) {
  const definition = LOCALE_DEFINITIONS[locale]
  NORMALIZED_LOCALE_LOOKUP.set(locale.toLowerCase(), locale)
  for (const alias of definition.aliases) {
    NORMALIZED_LOCALE_LOOKUP.set(alias, locale)
  }
}

const LOCALE_MODULES = import.meta.glob('./locales/*.json', { eager: true, import: 'default' }) as Record<string, TranslationCatalog>
const TRANSLATIONS: Partial<Record<AppLocale, Partial<Record<TranslationKey, string>>>> = buildTranslations()

export const APP_LOCALE_DEFINITIONS = APP_LOCALES.map((locale) => LOCALE_DEFINITIONS[locale])
export { EN_TRANSLATIONS }

function buildTranslations() {
  const translations: Partial<Record<AppLocale, Partial<Record<TranslationKey, string>>>> = {
    en: EN_TRANSLATIONS,
  }

  for (const [path, catalog] of Object.entries(LOCALE_MODULES)) {
    const match = path.match(/\/([^/]+)\.json$/)
    if (!match) continue

    const locale = normalizeLocaleCode(match[1])
    if (!locale || locale === 'en') continue

    translations[locale] = catalog
  }

  return translations
}

function isAppLocale(value: string): value is AppLocale {
  return APP_LOCALE_SET.has(value as AppLocale)
}

export function getLocaleDefinition(locale: AppLocale): LocaleDefinition {
  return LOCALE_DEFINITIONS[locale]
}

export function getLocaleDateLocale(locale: AppLocale): string {
  return LOCALE_DEFINITIONS[locale].dateLocale
}

export function interpolate(template: string, values: TranslationValues = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

function localizedInterpolationValues(locale: AppLocale, values?: TranslationValues): TranslationValues | undefined {
  if (!values || locale === 'en' || values.plural === undefined) return values
  return { ...values, plural: '' }
}

export function translate(locale: AppLocale, key: TranslationKey, values?: TranslationValues): string {
  const template = TRANSLATIONS[locale]?.[key] ?? EN_TRANSLATIONS[key]
  return interpolate(template, localizedInterpolationValues(locale, values))
}

export function createTranslator(locale: AppLocale = DEFAULT_APP_LOCALE) {
  return (key: TranslationKey, values?: TranslationValues) => translate(locale, key, values)
}

function normalizeLocaleCode(value: string): AppLocale | null {
  const normalized = value.trim().replaceAll('_', '-').toLowerCase()
  if (!normalized) return null

  const exactMatch = NORMALIZED_LOCALE_LOOKUP.get(normalized)
  if (exactMatch) return exactMatch

  const languageMatches = APP_LOCALES.filter((locale) => locale.toLowerCase().startsWith(`${normalized}-`))
  return languageMatches.length === 1 ? languageMatches[0] : null
}

export function normalizeUiLanguagePreference(value: unknown): UiLanguagePreference | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (lower === SYSTEM_UI_LANGUAGE || lower === 'auto') return SYSTEM_UI_LANGUAGE
  return normalizeLocaleCode(trimmed)
}

export function serializeUiLanguagePreference(value: unknown): AppLocale | null {
  const normalized = normalizeUiLanguagePreference(value)
  if (!normalized || normalized === SYSTEM_UI_LANGUAGE) return null
  return normalized
}

export function getBrowserLanguagePreferences(): string[] {
  if (typeof navigator === 'undefined') return []
  const languages = Array.isArray(navigator.languages) ? navigator.languages : []
  if (languages.length > 0) return [...languages]
  return navigator.language ? [navigator.language] : []
}

export function resolveEffectiveLocale(
  preference: unknown,
  languagePreferences: readonly string[] = getBrowserLanguagePreferences(),
): AppLocale {
  const normalizedPreference = normalizeUiLanguagePreference(preference)
  if (normalizedPreference && normalizedPreference !== SYSTEM_UI_LANGUAGE) {
    return normalizedPreference
  }

  for (const language of languagePreferences) {
    const locale = normalizeLocaleCode(language)
    if (locale) return locale
  }

  return DEFAULT_APP_LOCALE
}

export function localeDisplayName(locale: AppLocale, displayLocale: AppLocale = locale): string {
  return translate(displayLocale, LOCALE_DEFINITIONS[locale].labelKey)
}

export function localeSearchKeywords(locale: AppLocale): readonly string[] {
  return LOCALE_DEFINITIONS[locale].searchKeywords
}

export function hasLocaleCatalog(locale: AppLocale): boolean {
  return locale === 'en' || !!TRANSLATIONS[locale]
}

export function localeCatalogLocales(): AppLocale[] {
  return APP_LOCALES.filter((locale) => hasLocaleCatalog(locale))
}

export function isCanonicalAppLocale(value: string): value is AppLocale {
  return isAppLocale(value)
}
