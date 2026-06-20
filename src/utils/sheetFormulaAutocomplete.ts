import {
  DEFAULT_APP_LOCALE,
  translate,
  type AppLocale,
  type TranslationKey,
} from '../lib/i18n'

export interface SheetFormulaSuggestion {
  category: string
  categoryKey: TranslationKey
  name: string
  signature: string
  description: string
  descriptionKey: TranslationKey
}

export interface SheetFormulaAutocompleteMatch {
  prefix: string
  tokenStart: number
  tokenEnd: number
  suggestions: SheetFormulaSuggestion[]
}

export interface AppliedFormulaSuggestion {
  value: string
  cursor: number
}

const FORMULA_TOKEN_START_RE = /[=+\-*/^&(,;{]/
const FORMULA_TOKEN_RE = /^[A-Z0-9.]+$/
const MIN_FORMULA_PREFIX_LENGTH = 2
const MAX_FORMULA_SUGGESTIONS = 8

interface SheetFunctionGroup {
  categoryKey: TranslationKey
  functions: string[]
}

const NO_ARGUMENT_FUNCTIONS = new Set(['FALSE', 'NA', 'NOW', 'PI', 'RAND', 'TODAY', 'TRUE'])

interface SheetFunctionMetadata {
  descriptionKey: TranslationKey
  signature: string
}

const GENERIC_FUNCTION_DESCRIPTION_KEY = 'editor.sheet.formula.description.generic'

const COMMON_FUNCTION_METADATA: Record<string, SheetFunctionMetadata> = {
  ABS: { signature: 'ABS(value)', descriptionKey: 'editor.sheet.formula.description.abs' },
  AND: { signature: 'AND(value1, value2)', descriptionKey: 'editor.sheet.formula.description.and' },
  AVERAGE: { signature: 'AVERAGE(value1, value2)', descriptionKey: 'editor.sheet.formula.description.average' },
  CONCAT: { signature: 'CONCAT(text1, text2)', descriptionKey: 'editor.sheet.formula.description.concat' },
  CONCATENATE: { signature: 'CONCATENATE(text1, text2)', descriptionKey: 'editor.sheet.formula.description.concatenate' },
  COUNT: { signature: 'COUNT(value1, value2)', descriptionKey: 'editor.sheet.formula.description.count' },
  COUNTA: { signature: 'COUNTA(value1, value2)', descriptionKey: 'editor.sheet.formula.description.counta' },
  COUNTIF: { signature: 'COUNTIF(range, criterion)', descriptionKey: 'editor.sheet.formula.description.countif' },
  DATE: { signature: 'DATE(year, month, day)', descriptionKey: 'editor.sheet.formula.description.date' },
  DAY: { signature: 'DAY(date)', descriptionKey: 'editor.sheet.formula.description.day' },
  IF: { signature: 'IF(test, value_if_true, value_if_false)', descriptionKey: 'editor.sheet.formula.description.if' },
  IFERROR: { signature: 'IFERROR(value, fallback)', descriptionKey: 'editor.sheet.formula.description.iferror' },
  IFS: { signature: 'IFS(test1, value1, test2, value2)', descriptionKey: 'editor.sheet.formula.description.ifs' },
  INDEX: { signature: 'INDEX(range, row, column)', descriptionKey: 'editor.sheet.formula.description.index' },
  LEFT: { signature: 'LEFT(text, count)', descriptionKey: 'editor.sheet.formula.description.left' },
  LEN: { signature: 'LEN(text)', descriptionKey: 'editor.sheet.formula.description.len' },
  LOOKUP: { signature: 'LOOKUP(value, lookup_range, result_range)', descriptionKey: 'editor.sheet.formula.description.lookup' },
  LOWER: { signature: 'LOWER(text)', descriptionKey: 'editor.sheet.formula.description.lower' },
  MATCH: { signature: 'MATCH(value, range, match_type)', descriptionKey: 'editor.sheet.formula.description.match' },
  MAX: { signature: 'MAX(value1, value2)', descriptionKey: 'editor.sheet.formula.description.max' },
  MIN: { signature: 'MIN(value1, value2)', descriptionKey: 'editor.sheet.formula.description.min' },
  MONTH: { signature: 'MONTH(date)', descriptionKey: 'editor.sheet.formula.description.month' },
  NOT: { signature: 'NOT(value)', descriptionKey: 'editor.sheet.formula.description.not' },
  NOW: { signature: 'NOW()', descriptionKey: 'editor.sheet.formula.description.now' },
  OR: { signature: 'OR(value1, value2)', descriptionKey: 'editor.sheet.formula.description.or' },
  RIGHT: { signature: 'RIGHT(text, count)', descriptionKey: 'editor.sheet.formula.description.right' },
  ROUND: { signature: 'ROUND(value, digits)', descriptionKey: 'editor.sheet.formula.description.round' },
  ROUNDDOWN: { signature: 'ROUNDDOWN(value, digits)', descriptionKey: 'editor.sheet.formula.description.rounddown' },
  ROUNDUP: { signature: 'ROUNDUP(value, digits)', descriptionKey: 'editor.sheet.formula.description.roundup' },
  SUM: { signature: 'SUM(value1, value2)', descriptionKey: 'editor.sheet.formula.description.sum' },
  SUMIF: { signature: 'SUMIF(range, criterion, sum_range)', descriptionKey: 'editor.sheet.formula.description.sumif' },
  SUMIFS: { signature: 'SUMIFS(sum_range, criteria_range1, criterion1)', descriptionKey: 'editor.sheet.formula.description.sumifs' },
  TEXT: { signature: 'TEXT(value, format)', descriptionKey: 'editor.sheet.formula.description.text' },
  TODAY: { signature: 'TODAY()', descriptionKey: 'editor.sheet.formula.description.today' },
  TRIM: { signature: 'TRIM(text)', descriptionKey: 'editor.sheet.formula.description.trim' },
  UPPER: { signature: 'UPPER(text)', descriptionKey: 'editor.sheet.formula.description.upper' },
  VALUE: { signature: 'VALUE(text)', descriptionKey: 'editor.sheet.formula.description.value' },
  VLOOKUP: { signature: 'VLOOKUP(value, range, column, exact)', descriptionKey: 'editor.sheet.formula.description.vlookup' },
  XLOOKUP: { signature: 'XLOOKUP(value, lookup_range, return_range)', descriptionKey: 'editor.sheet.formula.description.xlookup' },
  YEAR: { signature: 'YEAR(date)', descriptionKey: 'editor.sheet.formula.description.year' },
}

const IRONCALC_FUNCTION_GROUPS: SheetFunctionGroup[] = [
  {
    categoryKey: 'editor.sheet.formula.category.logical',
    functions: ['AND', 'FALSE', 'IF', 'IFERROR', 'IFNA', 'IFS', 'NOT', 'OR', 'SWITCH', 'TRUE', 'XOR'],
  },
  {
    categoryKey: 'editor.sheet.formula.category.math',
    functions: [
      'ABS', 'ACOS', 'ACOSH', 'ASIN', 'ASINH', 'ATAN', 'ATAN2', 'ATANH', 'COS', 'COSH', 'PI', 'POWER',
      'PRODUCT', 'RAND', 'RANDBETWEEN', 'ROUND', 'ROUNDDOWN', 'ROUNDUP', 'SIN', 'SINH', 'SQRT', 'SQRTPI',
      'SUM', 'SUMIF', 'SUMIFS', 'TAN', 'TANH', 'SUBTOTAL',
    ],
  },
  {
    categoryKey: 'editor.sheet.formula.category.lookup',
    functions: [
      'CHOOSE', 'COLUMN', 'COLUMNS', 'HLOOKUP', 'INDEX', 'INDIRECT', 'LOOKUP', 'MATCH', 'OFFSET', 'ROW',
      'ROWS', 'VLOOKUP', 'XLOOKUP',
    ],
  },
  {
    categoryKey: 'editor.sheet.formula.category.text',
    functions: [
      'CONCAT', 'CONCATENATE', 'EXACT', 'FIND', 'LEFT', 'LEN', 'LOWER', 'MID', 'REPT', 'RIGHT', 'SEARCH',
      'SUBSTITUTE', 'T', 'TEXT', 'TEXTAFTER', 'TEXTBEFORE', 'TEXTJOIN', 'TRIM', 'UNICODE', 'UPPER',
      'VALUE', 'VALUETOTEXT',
    ],
  },
  {
    categoryKey: 'editor.sheet.formula.category.information',
    functions: [
      'ERROR.TYPE', 'FORMULATEXT', 'ISBLANK', 'ISERR', 'ISERROR', 'ISEVEN', 'ISFORMULA', 'ISLOGICAL',
      'ISNA', 'ISNONTEXT', 'ISNUMBER', 'ISODD', 'ISREF', 'ISTEXT', 'NA', 'SHEET', 'TYPE',
    ],
  },
  {
    categoryKey: 'editor.sheet.formula.category.statistical',
    functions: [
      'AVERAGE', 'AVERAGEA', 'AVERAGEIF', 'AVERAGEIFS', 'COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTIF',
      'COUNTIFS', 'GEOMEAN', 'MAX', 'MAXIFS', 'MIN', 'MINIFS',
    ],
  },
  {
    categoryKey: 'editor.sheet.formula.category.dateTime',
    functions: ['DATE', 'DAY', 'EDATE', 'EOMONTH', 'MONTH', 'NOW', 'TODAY', 'YEAR'],
  },
  {
    categoryKey: 'editor.sheet.formula.category.financial',
    functions: [
      'CUMIPMT', 'CUMPRINC', 'DB', 'DDB', 'DOLLARDE', 'DOLLARFR', 'EFFECT', 'FV', 'IPMT', 'IRR', 'ISPMT',
      'MIRR', 'NOMINAL', 'NPER', 'NPV', 'PDURATION', 'PMT', 'PPMT', 'PV', 'RATE', 'RRI', 'SLN', 'SYD',
      'TBILLEQ', 'TBILLPRICE', 'TBILLYIELD', 'XIRR', 'XNPV',
    ],
  },
  {
    categoryKey: 'editor.sheet.formula.category.engineering',
    functions: [
      'BESSELI', 'BESSELJ', 'BESSELK', 'BESSELY', 'BIN2DEC', 'BIN2HEX', 'BIN2OCT', 'BITAND', 'BITLSHIFT',
      'BITOR', 'BITRSHIFT', 'BITXOR', 'COMPLEX', 'CONVERT', 'DEC2BIN', 'DEC2HEX', 'DEC2OCT', 'DELTA',
      'ERF', 'ERF.PRECISE', 'ERFC', 'ERFC.PRECISE', 'GESTEP', 'HEX2BIN', 'HEX2DEC', 'HEX2OCT', 'IMABS',
      'IMAGINARY', 'IMARGUMENT', 'IMCONJUGATE', 'IMCOS', 'IMCOSH', 'IMCOT', 'IMCSC', 'IMCSCH', 'IMDIV',
      'IMEXP', 'IMLN', 'IMLOG10', 'IMLOG2', 'IMPOWER', 'IMPRODUCT', 'IMREAL', 'IMSEC', 'IMSECH', 'IMSIN',
      'IMSINH', 'IMSQRT', 'IMSUB', 'IMSUM', 'IMTAN', 'OCT2BIN', 'OCT2DEC', 'OCT2HEX',
    ],
  },
]

function defaultSignature(name: string): string {
  return NO_ARGUMENT_FUNCTIONS.has(name) ? `${name}()` : `${name}(...)`
}

function localizedFormulaDescription(locale: AppLocale, key: TranslationKey, category: string): string {
  return translate(locale, key, { category })
}

export function localizeSheetFormulaSuggestion(
  suggestion: SheetFormulaSuggestion,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): SheetFormulaSuggestion {
  const category = translate(locale, suggestion.categoryKey)
  return {
    ...suggestion,
    category,
    description: localizedFormulaDescription(locale, suggestion.descriptionKey, category),
  }
}

function buildFunctionSuggestion(name: string, categoryKey: TranslationKey): SheetFormulaSuggestion {
  const metadata = COMMON_FUNCTION_METADATA[name]
  const category = translate(DEFAULT_APP_LOCALE, categoryKey)
  const descriptionKey = metadata?.descriptionKey ?? GENERIC_FUNCTION_DESCRIPTION_KEY
  return {
    categoryKey,
    category,
    name,
    signature: metadata?.signature ?? defaultSignature(name),
    description: localizedFormulaDescription(DEFAULT_APP_LOCALE, descriptionKey, category),
    descriptionKey,
  }
}

export const SHEET_FORMULA_SUGGESTIONS: SheetFormulaSuggestion[] = IRONCALC_FUNCTION_GROUPS.flatMap(
  (group) => group.functions.map((name) => buildFunctionSuggestion(name, group.categoryKey)),
)

function lastFormulaTokenStart(value: string, cursor: number): number {
  let tokenStart = 0
  for (let index = cursor - 1; index >= 0; index -= 1) {
    if (FORMULA_TOKEN_START_RE.test(value[index] ?? '')) {
      tokenStart = index + 1
      break
    }
  }
  return tokenStart
}

export function matchFormulaAutocomplete(
  value: string,
  cursor: number,
  locale: AppLocale = DEFAULT_APP_LOCALE,
): SheetFormulaAutocompleteMatch | null {
  if (!value.trimStart().startsWith('=')) return null

  const safeCursor = Math.max(0, Math.min(cursor, value.length))
  const tokenStart = lastFormulaTokenStart(value, safeCursor)
  const prefix = value.slice(tokenStart, safeCursor).toUpperCase()
  if (prefix.length < MIN_FORMULA_PREFIX_LENGTH || !FORMULA_TOKEN_RE.test(prefix)) return null

  const suggestions = SHEET_FORMULA_SUGGESTIONS
    .filter((suggestion) => suggestion.name.startsWith(prefix))
    .slice(0, MAX_FORMULA_SUGGESTIONS)
    .map((suggestion) => localizeSheetFormulaSuggestion(suggestion, locale))

  if (suggestions.length === 0) return null

  return {
    prefix,
    tokenStart,
    tokenEnd: safeCursor,
    suggestions,
  }
}

export function applyFormulaSuggestion(
  value: string,
  tokenStart: number,
  tokenEnd: number,
  suggestion: SheetFormulaSuggestion,
): AppliedFormulaSuggestion {
  const alreadyHasOpeningParen = value[tokenEnd] === '('
  const insertion = alreadyHasOpeningParen ? suggestion.name : `${suggestion.name}(`
  const nextValue = `${value.slice(0, tokenStart)}${insertion}${value.slice(tokenEnd)}`

  return {
    value: nextValue,
    cursor: tokenStart + insertion.length + (alreadyHasOpeningParen ? 1 : 0),
  }
}
