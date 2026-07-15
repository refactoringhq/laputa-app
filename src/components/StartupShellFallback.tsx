export function StartupShellFallback() {
  return (
    <div className="startup-shell-fallback" data-testid="startup-shell-fallback" aria-hidden="true">
      <div className="startup-shell-fallback__sidebar">
        <div className="startup-shell-fallback__sidebar-block startup-shell-fallback__sidebar-block--short" />
        <div className="startup-shell-fallback__nav">
          <div className="startup-shell-fallback__line startup-shell-fallback__line--strong" />
          <div className="startup-shell-fallback__line" />
          <div className="startup-shell-fallback__line" />
        </div>
        <div className="startup-shell-fallback__nav startup-shell-fallback__nav--lower">
          <div className="startup-shell-fallback__line startup-shell-fallback__line--wide" />
          <div className="startup-shell-fallback__line" />
          <div className="startup-shell-fallback__line startup-shell-fallback__line--narrow" />
        </div>
      </div>
      <div className="startup-shell-fallback__list">
        <div className="startup-shell-fallback__list-header" />
        <div className="startup-shell-fallback__item" />
        <div className="startup-shell-fallback__item startup-shell-fallback__item--selected" />
        <div className="startup-shell-fallback__item" />
      </div>
      <div className="startup-shell-fallback__editor">
        <div className="startup-shell-fallback__editor-title" />
        <div className="startup-shell-fallback__editor-line startup-shell-fallback__editor-line--wide" />
        <div className="startup-shell-fallback__editor-line" />
        <div className="startup-shell-fallback__editor-line startup-shell-fallback__editor-line--short" />
      </div>
    </div>
  )
}
