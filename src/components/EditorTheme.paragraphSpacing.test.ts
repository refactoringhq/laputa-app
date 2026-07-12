import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const paragraphSpacingDeclaration = /--editor-paragraph-spacing\s*:\s*([^;]+);/gi
const zeroLengthValues = new Set(['0', '0em', '0px', '0rem'])

function readCss(relativePath: string): string {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8')
}

function paragraphSpacingValues(css: string): string[] {
  return Array.from(css.matchAll(paragraphSpacingDeclaration), (match) => match[1].trim())
}

function isNonZeroLength(value: string): boolean {
  return /\d/.test(value) && !zeroLengthValues.has(value.toLowerCase())
}

describe('editor paragraph spacing theme', () => {
  it('uses the paragraph spacing variable for rich-editor paragraph gaps', () => {
    expect(readCss('components/EditorTheme.css')).toMatch(
      /margin-bottom:\s*var\(--editor-paragraph-spacing\)/,
    )
  })

  it('defines non-zero paragraph spacing in both color theme scopes', () => {
    const spacingValues = paragraphSpacingValues(readCss('index.css'))

    expect(spacingValues).toHaveLength(2)
    expect(spacingValues.every(isNonZeroLength)).toBe(true)
  })
})
