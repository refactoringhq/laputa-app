import { describe, expect, it } from 'vitest'
import { htmlBlockIframeSrcDoc, sanitizeHtmlBlockMarkup } from './htmlBlockSandbox'

describe('HTML block sandbox', () => {
  it('removes script execution surfaces and keeps static interactive markup', () => {
    const sanitized = sanitizeHtmlBlockMarkup([
      '<script>window.parent.document.body.remove()</script>',
      '<button onclick="window.parent.evil = true">Click</button>',
      '<a href="javascript:alert(1)">bad</a>',
      '<a href="https://example.com/docs">docs</a>',
      '<details open><summary>More</summary><p>Safe</p></details>',
    ].join(''))

    expect(sanitized).not.toContain('<script')
    expect(sanitized).not.toContain('onclick')
    expect(sanitized).not.toContain('javascript:')
    expect(sanitized).toContain('<button>Click</button>')
    expect(sanitized).toContain('<details open="">')
    expect(sanitized).toContain('href="https://example.com/docs"')
    expect(sanitized).toContain('target="_blank"')
    expect(sanitized).toContain('rel="noreferrer noopener"')
  })

  it('removes nested browsing contexts and remote-loading attributes', () => {
    const sanitized = sanitizeHtmlBlockMarkup([
      '<iframe src="https://example.com"></iframe>',
      '<img src="https://example.com/tracker.png" srcset="https://example.com/2x.png 2x">',
      '<div style="background-image: url(https://example.com/pixel.png); color: red">Styled</div>',
      '<style>@import url("https://example.com/a.css"); .ok { color: red }</style>',
    ].join(''))

    expect(sanitized).not.toContain('<iframe')
    expect(sanitized).not.toContain('src=')
    expect(sanitized).not.toContain('srcset=')
    expect(sanitized).not.toContain('url(')
    expect(sanitized).not.toContain('@import')
    expect(sanitized).toContain('Styled')
  })

  it('generates a srcdoc with a restrictive CSP and no script permission dependency', () => {
    const srcDoc = htmlBlockIframeSrcDoc('<h1>Hello</h1>')

    expect(srcDoc).toContain("script-src 'none'")
    expect(srcDoc).toContain("default-src 'none'")
    expect(srcDoc).toContain('<h1>Hello</h1>')
  })
})
