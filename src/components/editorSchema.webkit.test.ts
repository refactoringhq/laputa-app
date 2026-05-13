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

function installMockRegExp(shouldReject: (pattern: string | RegExp | undefined, flags: string | undefined) => boolean) {
  const LegacyWebKitRegExp = function (pattern?: string | RegExp, flags?: string) {
    if (shouldReject(pattern, flags)) {
      throw new SyntaxError('Invalid regular expression: invalid group specifier name')
    }

    return new NativeRegExp(pattern, flags)
  } as RegExpConstructor

  Object.setPrototypeOf(LegacyWebKitRegExp, NativeRegExp)
  LegacyWebKitRegExp.prototype = NativeRegExp.prototype

  setRegExpConstructor(LegacyWebKitRegExp)
}

function installLegacyWebKitRegExp() {
  installMockRegExp((_pattern, flags) => Boolean(flags?.includes('d') || flags?.includes('v')))
}

function installLookbehindMissingRegExp() {
  installMockRegExp((pattern) => typeof pattern === 'string' && pattern.includes('(?<'))
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

  it('omits the Shiki highlighter when WebKit lacks regex lookbehind syntax', async () => {
    installLookbehindMissingRegExp()
    vi.resetModules()

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')

    expect(createTolariaCodeBlockOptions()).not.toHaveProperty('createHighlighter')
  })
})
