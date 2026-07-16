import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StartupShellFallback } from './StartupShellFallback'

const STARTUP_SHELL_FALLBACK_HTML_KEY = '__tolariaStartupShellFallbackHtml'

describe('StartupShellFallback', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, STARTUP_SHELL_FALLBACK_HTML_KEY)
    document.body.innerHTML = ''
  })

  it('renders the startup shell content captured from index.html', () => {
    Reflect.set(window, STARTUP_SHELL_FALLBACK_HTML_KEY, [
      '<div class="startup-shell-fallback__sidebar"></div>',
      '<div class="startup-shell-fallback__list"></div>',
      '<div class="startup-shell-fallback__editor">',
      '<div class="startup-shell-fallback__editor-title"></div>',
      '</div>',
    ].join(''))

    render(<StartupShellFallback />)

    const shell = screen.getByTestId('startup-shell-fallback')
    expect(shell.getAttribute('aria-hidden')).toBe('true')
    expect(shell.querySelector('.startup-shell-fallback__sidebar')).not.toBeNull()
    expect(shell.querySelector('.startup-shell-fallback__editor-title')).not.toBeNull()
  })

  it('falls back to the static boot shell when the capture script has not run', () => {
    document.body.innerHTML = [
      '<div id="tolaria-boot-shell">',
      '<div class="startup-shell-fallback__list"></div>',
      '</div>',
    ].join('')

    render(<StartupShellFallback />)

    const shell = screen.getByTestId('startup-shell-fallback')
    expect(shell.querySelector('.startup-shell-fallback__list')).not.toBeNull()
  })
})
