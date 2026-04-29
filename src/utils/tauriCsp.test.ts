import { readFileSync } from 'node:fs'
import { RUNTIME_STYLE_NONCE_SOURCE } from '../lib/runtimeStyleNonce'

describe('Tauri Content Security Policy', () => {
  it('allows nonce-tagged runtime style elements and React style attributes', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))
    const csp = config.app.security.csp as Record<string, string>

    expect(csp['style-src']).toContain("'unsafe-inline'")
    expect(csp['style-src-elem']).toContain(RUNTIME_STYLE_NONCE_SOURCE)
    expect(csp['style-src-elem']).toContain('https://fonts.googleapis.com')
    expect(csp['style-src-attr']).toBe("'unsafe-inline'")
  })

  it('allows PDF object previews from scoped Tauri asset URLs', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))
    const csp = config.app.security.csp as Record<string, string>

    expect(csp['object-src']).toContain('asset:')
    expect(csp['object-src']).toContain('http://asset.localhost')
  })
})
