import DOMPurify from 'dompurify'

const REMOTE_LOADING_ATTRIBUTES = [
  'action',
  'formaction',
  'ping',
  'poster',
  'src',
  'srcset',
  'xlink:href',
]
const HTML_BLOCK_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
].join('; ')

const HTML_BLOCK_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['base', 'embed', 'iframe', 'link', 'meta', 'object', 'script'],
}

interface HtmlBlockPreview {
  sanitizedHtml: string
  srcDoc: string
}

function stripCssRemoteLoads(css: string): string {
  return css
    .replace(/@import[^;]+;?/giu, '')
    .replace(/url\s*\([^)]*\)/giu, '')
}

function removeRemoteLoadingAttributes(element: Element): void {
  for (const attribute of REMOTE_LOADING_ATTRIBUTES) {
    element.removeAttribute(attribute)
  }
}

function sanitizeInlineStyle(element: Element): void {
  const style = element.getAttribute('style')
  if (style === null) return

  const sanitized = stripCssRemoteLoads(style).trim()
  if (sanitized.length > 0) {
    element.setAttribute('style', sanitized)
  } else {
    element.removeAttribute('style')
  }
}

function sanitizeStyleElement(element: Element): void {
  element.textContent = stripCssRemoteLoads(element.textContent ?? '')
}

function sanitizeAnchor(anchor: HTMLAnchorElement): void {
  if (!anchor.hasAttribute('href')) return

  anchor.setAttribute('target', '_blank')
  anchor.setAttribute('rel', 'noreferrer noopener')
}

function sanitizeParsedHtml(documentObject: Document): string {
  documentObject.body.querySelectorAll('*').forEach((element) => {
    removeRemoteLoadingAttributes(element)
    sanitizeInlineStyle(element)
    if (element instanceof HTMLStyleElement) sanitizeStyleElement(element)
    if (element instanceof HTMLAnchorElement) sanitizeAnchor(element)
  })
  return documentObject.body.innerHTML
}

export function sanitizeHtmlBlockMarkup(markup: string): string {
  const sanitized = DOMPurify.sanitize(markup, HTML_BLOCK_SANITIZE_CONFIG)
  const parsed = new DOMParser().parseFromString(sanitized, 'text/html')
  return sanitizeParsedHtml(parsed)
}

function htmlBlockIframeSrcDocFromSanitizedHtml(sanitizedHtml: string): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${HTML_BLOCK_CSP}">`,
    '<style>',
    ':root { color-scheme: light dark; }',
    'html, body { margin: 0; min-height: 100%; }',
    'body { box-sizing: border-box; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: CanvasText; background: Canvas; }',
    'a { color: LinkText; }',
    '* { box-sizing: border-box; max-width: 100%; }',
    '</style>',
    '</head>',
    '<body>',
    sanitizedHtml,
    '</body>',
    '</html>',
  ].join('')
}

export function htmlBlockPreview(markup: string): HtmlBlockPreview {
  const sanitizedHtml = sanitizeHtmlBlockMarkup(markup)
  return {
    sanitizedHtml,
    srcDoc: htmlBlockIframeSrcDocFromSanitizedHtml(sanitizedHtml),
  }
}

export function htmlBlockIframeSrcDoc(markup: string): string {
  return htmlBlockPreview(markup).srcDoc
}
