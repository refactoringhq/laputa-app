import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const nativeRegExpDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'RegExp')
const NativeRegExp = RegExp

function setRegExpConstructor(value: RegExpConstructor) {
  Object.defineProperty(globalThis, 'RegExp', {
    configurable: true,
    writable: true,
    value,
  })
}

function restoreRegExpConstructor() {
  if (nativeRegExpDescriptor) {
    Object.defineProperty(globalThis, 'RegExp', nativeRegExpDescriptor)
  }
}

function rejectsLegacyWebKitRegex(source: string, flags?: string): boolean {
  if (flags?.includes('d')) return true
  if (flags?.includes('v')) return true
  return source.includes('(?<')
}

function installLegacyWebKitRegExp() {
  const LegacyWebKitRegExp = function (pattern?: string | RegExp, flags?: string) {
    const source = pattern instanceof NativeRegExp ? pattern.source : String(pattern ?? '')
    if (rejectsLegacyWebKitRegex(source, flags)) {
      throw new SyntaxError('Invalid regular expression: invalid group specifier name')
    }

    return new NativeRegExp(pattern, flags)
  } as RegExpConstructor

  Object.setPrototypeOf(LegacyWebKitRegExp, NativeRegExp)
  LegacyWebKitRegExp.prototype = NativeRegExp.prototype

  setRegExpConstructor(LegacyWebKitRegExp)
}

afterEach(() => {
  restoreRegExpConstructor()
  vi.resetModules()
})

describe('MarkdownContent WebKit regex fallback', () => {
  it('renders AI code fences without syntax highlighting when modern regex features are unavailable', async () => {
    installLegacyWebKitRegExp()
    vi.resetModules()

    const { MarkdownContent } = await import('./MarkdownContent')

    expect(() => {
      render(<MarkdownContent content={'```ts\nconst prompt = "(?<name>.*)"\n```'} />)
    }).not.toThrow()
    expect(screen.getByText('const prompt = "(?<name>.*)"')).toBeInTheDocument()
  })

  it('renders AI markdown with email text when regex lookbehind is unavailable', async () => {
    installLegacyWebKitRegExp()
    vi.resetModules()

    const { MarkdownContent } = await import('./MarkdownContent')

    expect(() => {
      render(<MarkdownContent content="Contact luca@example.com for details" />)
    }).not.toThrow()
    expect(screen.getByText('Contact luca@example.com for details')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'luca@example.com' })).not.toBeInTheDocument()
  })
})
