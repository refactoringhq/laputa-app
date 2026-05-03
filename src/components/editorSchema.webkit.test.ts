import { afterEach, describe, expect, it, vi } from 'vitest'

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

function installLegacyWebKitRegExp() {
  const LegacyWebKitRegExp = function (pattern?: string | RegExp, flags?: string) {
    if (flags?.includes('d') || flags?.includes('v')) {
      throw new SyntaxError('Invalid flags supplied to RegExp constructor')
    }

    return new NativeRegExp(pattern, flags)
  } as RegExpConstructor

  Object.setPrototypeOf(LegacyWebKitRegExp, NativeRegExp)
  LegacyWebKitRegExp.prototype = NativeRegExp.prototype

  setRegExpConstructor(LegacyWebKitRegExp)
}

afterEach(() => {
  document.documentElement.classList.remove('dark')
  delete document.documentElement.dataset.theme
  restoreRegExpConstructor()
  vi.resetModules()
})

describe('editor schema code block highlighting', () => {
  it('uses the light Shiki theme first in light mode', async () => {
    vi.resetModules()
    document.documentElement.classList.remove('dark')
    document.documentElement.dataset.theme = 'light'

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')
    const highlighter = await createTolariaCodeBlockOptions().createHighlighter?.()

    expect(highlighter?.getLoadedThemes()[0]).toBe('github-light')
  })

  it('uses the dark Shiki theme first in dark mode', async () => {
    vi.resetModules()
    document.documentElement.classList.add('dark')
    document.documentElement.dataset.theme = 'dark'

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')
    const highlighter = await createTolariaCodeBlockOptions().createHighlighter?.()

    expect(highlighter?.getLoadedThemes()[0]).toBe('github-dark')
  })

  it('omits the Shiki highlighter when WebKit lacks precompiled regex flags', async () => {
    installLegacyWebKitRegExp()
    vi.resetModules()

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')

    expect(createTolariaCodeBlockOptions()).not.toHaveProperty('createHighlighter')
  })
})
