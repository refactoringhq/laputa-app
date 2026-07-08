import { readFileSync } from 'node:fs'

describe('Tauri Content Security Policy', () => {
  it('allows runtime style elements and React style attributes', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))
    const csp = config.app.security.csp as Record<string, string>

    expect(csp['style-src']).toContain("'unsafe-inline'")
    expect(csp['style-src-elem']).not.toContain("'nonce-")
    expect(csp['style-src-elem']).toContain("'unsafe-inline'")
    expect(csp['style-src-elem']).toContain('https://fonts.googleapis.com')
    expect(csp['style-src-attr']).toBe("'unsafe-inline'")
    expect(config.app.security.dangerousDisableAssetCspModification).toContain('style-src')
  })

  it('allows PDF object previews from scoped Tauri asset URLs', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))
    const csp = config.app.security.csp as Record<string, string>

    expect(csp['object-src']).toContain('asset:')
    expect(csp['object-src']).toContain('http://asset.localhost')
  })

  it('allows packaged PDF viewer frames from scoped Tauri asset URLs', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))
    const csp = config.app.security.csp as Record<string, string>
    const devCsp = config.app.security.devCsp as string

    expect(csp['frame-src']).toBe("'self' asset: http://asset.localhost")
    expect(devCsp).toContain("frame-src 'self' asset: http://asset.localhost")
  })

  it('allows audio and video media previews from scoped Tauri asset URLs', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))
    const csp = config.app.security.csp as Record<string, string>

    expect(csp['media-src']).toContain('asset:')
    expect(csp['media-src']).toContain('http://asset.localhost')
  })

  it('allows bundled tldraw translation JSON fetched from inlined data URLs', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))
    const csp = config.app.security.csp as Record<string, string>

    expect(csp['connect-src']).toContain('data:')
  })

  it('uses a dev-only CSP that permits Vite React Refresh without weakening production script policy', () => {
    const config = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/tauri.conf.json`, 'utf8'))
    const productionCsp = config.app.security.csp as Record<string, string>
    const devCsp = config.app.security.devCsp as string

    expect(productionCsp['script-src']).not.toContain("'unsafe-inline'")
    expect(productionCsp['script-src']).not.toContain("'unsafe-eval'")
    expect(productionCsp['script-src']).toContain("'wasm-unsafe-eval'")
    expect(devCsp).toContain("'unsafe-inline'")
    expect(devCsp).toContain("'unsafe-eval'")
    expect(devCsp).toContain('ws://localhost:5202')
  })
})
