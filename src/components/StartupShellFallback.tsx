const STARTUP_SHELL_FALLBACK_HTML_KEY = '__tolariaStartupShellFallbackHtml'

function startupShellFallbackHtml() {
  const capturedHtml = Reflect.get(window, STARTUP_SHELL_FALLBACK_HTML_KEY)
  if (typeof capturedHtml === 'string') return capturedHtml

  return document.getElementById('tolaria-boot-shell')?.innerHTML
    ?? ''
}

export function StartupShellFallback() {
  const html = startupShellFallbackHtml()

  return (
    <div
      className="startup-shell-fallback"
      data-testid="startup-shell-fallback"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
