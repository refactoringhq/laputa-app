import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXTRA_CODE_BLOCK_LANGUAGES } from '../utils/codeBlockLanguageCatalog'

const nativeRegExpDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'RegExp')
const NativeRegExp = RegExp
const originalUserAgent = navigator.userAgent
const CHROMIUM_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36'

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

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
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

beforeEach(() => {
  setUserAgent(CHROMIUM_USER_AGENT)
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
  delete document.documentElement.dataset.theme
  setUserAgent(originalUserAgent)
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

  it('registers Go as a selectable Shiki code block language', async () => {
    vi.resetModules()

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')
    const options = createTolariaCodeBlockOptions()

    expect(options.supportedLanguages?.go).toMatchObject({
      name: 'Go',
      aliases: ['go', 'golang'],
    })
  })

  it('registers additional common Shiki code block languages', async () => {
    vi.resetModules()

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')
    const options = createTolariaCodeBlockOptions()

    expect(options.supportedLanguages?.powershell).toMatchObject({
      name: 'PowerShell',
      aliases: ['powershell', 'ps', 'ps1'],
    })
    expect(options.supportedLanguages?.vbscript).toMatchObject({
      name: 'VBScript',
      aliases: ['vbscript', 'vbs', 'vb', 'vba', 'visual-basic', 'visualbasic'],
    })
    expect(options.supportedLanguages?.dart).toMatchObject({
      name: 'Dart',
      aliases: ['dart'],
    })
    expect(options.supportedLanguages?.hcl).toMatchObject({
      name: 'HCL',
      aliases: ['hcl'],
    })
    expect(options.supportedLanguages?.terraform).toMatchObject({
      name: 'Terraform',
      aliases: ['terraform', 'tf', 'tfvars'],
    })
    expect(options.supportedLanguages?.dockerfile).toMatchObject({
      name: 'Dockerfile',
      aliases: ['dockerfile', 'docker'],
    })
    expect(options.supportedLanguages?.php).toMatchObject({
      name: 'PHP',
      aliases: ['php'],
    })
  })

  it('loads the Go Shiki grammar for Go code blocks', async () => {
    vi.resetModules()

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')
    const highlighter = await createTolariaCodeBlockOptions().createHighlighter?.()

    await expect(highlighter?.loadLanguage('go')).resolves.toBeUndefined()
    expect(highlighter?.getLoadedLanguages()).toContain('go')
  })

  it.each([
    ...EXTRA_CODE_BLOCK_LANGUAGES.map(language => [language.id, language.id]),
    ['ps1', 'ps1'],
    ['vb', 'vb'],
    ['php', 'php'],
  ])('loads the %s Shiki grammar for code blocks', async (language, loadedLanguage) => {
    vi.resetModules()

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')
    const highlighter = await createTolariaCodeBlockOptions().createHighlighter?.()

    await expect(highlighter?.loadLanguage(language)).resolves.toBeUndefined()
    expect(highlighter?.getLoadedLanguages()).toContain(loadedLanguage)
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

  it('omits the Shiki highlighter on WebKit even when the simple regex probe passes', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 Safari/605.1.15')
    vi.resetModules()

    const { createTolariaCodeBlockOptions } = await import('./codeBlockOptions')

    expect(createTolariaCodeBlockOptions()).not.toHaveProperty('createHighlighter')
  })
})
