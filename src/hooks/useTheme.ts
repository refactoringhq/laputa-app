import { useMemo } from 'react'
import themeConfig from '../theme.json'

type ThemeValue = string | number | Record<string, unknown> | unknown[]

function isThemeBranch(value: ThemeValue): value is Record<string, ThemeValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUnitlessThemeNumber(key: string, cssKey: string): boolean {
  return /weight|lineHeight|opacity/i.test(key)
    || cssKey.includes('line-height')
    || cssKey.includes('font-weight')
}

function themeCssValue(key: string, cssKey: string, value: string | number): string {
  if (typeof value !== 'number') return String(value)
  if (isUnitlessThemeNumber(key, cssKey)) return String(value)
  return `${value}px`
}

/** Convert a nested theme config object into a flat map of CSS custom properties */
function flattenTheme(
  obj: Record<string, ThemeValue>,
  prefix = '--'
): Record<string, string> {
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(obj)) {
    const cssKey = `${prefix}${camelToKebab(key)}`

    if (value === null || value === undefined) continue
    if (Array.isArray(value)) continue // skip arrays (e.g. nestedBulletSymbols)

    if (isThemeBranch(value)) {
      Object.assign(result, flattenTheme(value, `${cssKey}-`))
      continue
    }

    if (typeof value !== 'string' && typeof value !== 'number') continue
    Reflect.set(result, cssKey, themeCssValue(key, cssKey, value))
  }

  return result
}

function camelToKebab(str: string): string {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

export function useEditorTheme() {
  const { cssVars, styleString } = useMemo(() => {
    const vars = flattenTheme(themeConfig as Record<string, ThemeValue>)
    const str = Object.entries(vars)
      .map(([k, v]) => `${k}: ${v};`)
      .join('\n')
    return { cssVars: vars, styleString: str }
  }, [])

  return { themeConfig, cssVars, styleString }
}
