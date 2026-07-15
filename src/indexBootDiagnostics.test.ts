import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function indexHtml(): string {
  return readFileSync(`${process.cwd()}/index.html`, 'utf8')
}

function firstInlineScriptFromIndex(): string {
  const match = indexHtml().match(/<script>\s*([\s\S]*?)\s*<\/script>/)
  if (!match) throw new Error('index.html startup script was not found')
  return match[1]
}

describe('index startup script', () => {
  it('does not ship a visible boot diagnostics element by default', () => {
    const html = indexHtml()

    expect(html).not.toContain('Tolaria boot: HTML parsed')
    expect(html).not.toContain('<pre id="tolaria-boot-diagnostics"')
  })

  it('ships a static startup shell before the React module loads', () => {
    const html = indexHtml()
    const rootMatch = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<script type="module" src="\/src\/main\.tsx"><\/script>/)

    expect(rootMatch?.[1]).toContain('id="tolaria-boot-shell"')
    expect(rootMatch?.[1]).toContain('class="startup-shell-fallback"')
    expect(rootMatch?.[1]).toContain('aria-hidden="true"')
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
