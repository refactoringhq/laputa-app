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
  restoreRegExpConstructor()
  vi.resetModules()
})

describe('editor schema code block highlighting', () => {
  it('omits the Shiki highlighter when WebKit lacks precompiled regex flags', async () => {
    installLegacyWebKitRegExp()
    vi.resetModules()

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')

    expect(createTolariaCodeBlockOptions()).not.toHaveProperty('createHighlighter')
  })
})
