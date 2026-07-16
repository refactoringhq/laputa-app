import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const STARTUP_SHELL_FALLBACK_HTML_KEY = '__tolariaStartupShellFallbackHtml'

function indexHtml(): string {
  return readFileSync(`${process.cwd()}/index.html`, 'utf8')
}

function inlineScriptsFromIndex(): string[] {
  return [...indexHtml().matchAll(/<script>\s*([\s\S]*?)\s*<\/script>/g)].map((match) => match[1])
}

function startupRootContentFromIndex(): string {
  const match = indexHtml().match(/<div id="root">([\s\S]*?)<\/div>\s*<script>\s*\(function \(\) \{\s*var bootShell/)
  if (!match) throw new Error('index.html startup shell root was not found')
  return match[1]
}

function firstInlineScriptFromIndex(): string {
  const script = inlineScriptsFromIndex()[0]
  if (!script) throw new Error('index.html startup script was not found')
  return script
}

describe('index startup script', () => {
  it('does not ship a visible boot diagnostics element by default', () => {
    const html = indexHtml()

    expect(html).not.toContain('Tolaria boot: HTML parsed')
    expect(html).not.toContain('<pre id="tolaria-boot-diagnostics"')
  })

  it('ships a static startup shell before the React module loads', () => {
    const rootContent = startupRootContentFromIndex()

    expect(rootContent).toContain('id="tolaria-boot-shell"')
    expect(rootContent).toContain('class="startup-shell-fallback"')
    expect(rootContent).toContain('aria-hidden="true"')
  })

  it('captures the static startup shell markup for the React fallback', () => {
    const captureScript = inlineScriptsFromIndex().find((script) =>
      script.includes('__tolariaStartupShellFallbackHtml'))
    if (!captureScript) throw new Error('index.html startup shell capture script was not found')

    Reflect.deleteProperty(window, STARTUP_SHELL_FALLBACK_HTML_KEY)
    document.body.innerHTML = `<div id="root">${startupRootContentFromIndex()}</div>`
    new Function(captureScript)()

    const capturedHtml = Reflect.get(window, STARTUP_SHELL_FALLBACK_HTML_KEY)
    expect(capturedHtml).toContain('startup-shell-fallback__editor-title')
    expect(capturedHtml).not.toContain('tolaria-boot-shell')
  })

  it('does not show the boot overlay for ResizeObserver loop notifications', () => {
    document.body.innerHTML = ''
    new Function(firstInlineScriptFromIndex())()

    const event = new ErrorEvent('error', {
      cancelable: true,
      message: 'ResizeObserver loop completed with undelivered notifications.',
    })
    window.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.body.children).toHaveLength(0)
  })

  it('does not create a visible boot overlay for real startup errors', () => {
    document.body.innerHTML = ''
    new Function(firstInlineScriptFromIndex())()

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'startup failed',
      filename: 'app.js',
      lineno: 1,
      colno: 2,
    }))

    expect(document.body.children).toHaveLength(0)
  })
})
