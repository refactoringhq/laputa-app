import {
  de,
  en,
  es,
  fr,
  it,
  ja,
  ko,
  pl,
  pt,
  ru,
  uk,
  vi,
  zh,
  zhTW,
} from '@blocknote/core/locales'
import {
  locales as multiColumnLocales,
  type MultiColumnDictionary,
} from '@blocknote/xl-multi-column'
import type { AppLocale } from '../lib/i18n'

const knownBlockNoteLocales = {
  de,
  en,
  es,
  fr,
  it,
  ja,
  ko,
  pl,
  pt,
  ru,
  uk,
  vi,
  zh,
  zhTW,
}

type BlockNoteLocaleKey = keyof typeof knownBlockNoteLocales
type MultiColumnLocaleKey = keyof typeof multiColumnLocales

const BLOCKNOTE_LOCALE_BY_APP_LOCALE = {
  en: 'en',
  'it-IT': 'it',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'ru-RU': 'ru',
  'es-ES': 'es',
  'pt-BR': 'pt',
  'pt-PT': 'pt',
  'es-419': 'es',
  'zh-CN': 'zh',
  'zh-TW': 'zhTW',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  vi: 'vi',
  'pl-PL': 'pl',
  'be-BY': 'en',
  'be-Latn': 'en',
  'id-ID': 'en',
  'uk-UA': 'uk',
  'sv-SE': 'en',
} satisfies Record<AppLocale, BlockNoteLocaleKey>

const MULTI_COLUMN_LOCALE_BY_APP_LOCALE = {
  en: 'en',
  'it-IT': 'en',
  'fr-FR': 'fr',
  'de-DE': 'de',
  'ru-RU': 'ru',
  'es-ES': 'es',
  'pt-BR': 'pt',
  'pt-PT': 'pt',
  'es-419': 'es',
  'zh-CN': 'zh',
  'zh-TW': 'zh',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  vi: 'vi',
  'pl-PL': 'pl',
  'be-BY': 'en',
  'be-Latn': 'en',
  'id-ID': 'en',
  'uk-UA': 'en',
  'sv-SE': 'en',
} satisfies Record<AppLocale, MultiColumnLocaleKey>

export function blockNoteDictionaryForLocale(locale: AppLocale) {
  const blockNoteLocale =
    knownBlockNoteLocales[BLOCKNOTE_LOCALE_BY_APP_LOCALE[locale]]
  const multiColumnLocale = multiColumnLocales[
    MULTI_COLUMN_LOCALE_BY_APP_LOCALE[locale]
  ] as MultiColumnDictionary

  return {
    ...blockNoteLocale,
    multi_column: multiColumnLocale,
  }
}
