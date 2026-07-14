import DOMPurify from 'dompurify'
import {
  HTML_BLOCK_SCRIPTS_SANDBOXED,
  normalizeHtmlBlockScripts,
  type HtmlBlockScripts,
} from './htmlBlockMarkdown'

const REMOTE_LOADING_ATTRIBUTES = [
  'action',
  'formaction',
  'ping',
  'poster',
  'src',
  'srcset',
  'xlink:href',
]
const HTML_BLOCK_BASE_CSP_DIRECTIVES = [
  "default-src 'none'",
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
]
const HTML_BLOCK_ALLOWED_URI_PATTERN = /^(?:(?:https?|mailto|tel|tolaria):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/iu
const EXECUTABLE_SCRIPT_TYPES = new Set(['', 'application/javascript', 'text/javascript'])
const DATA_SCRIPT_TYPES = new Set(['application/json', 'application/ld+json', 'text/plain'])

const HTML_BLOCK_SANITIZE_CONFIG = {
  ALLOWED_URI_REGEXP: HTML_BLOCK_ALLOWED_URI_PATTERN,
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['base', 'embed', 'iframe', 'link', 'meta', 'object', 'script'],
  WHOLE_DOCUMENT: true,
}

interface HtmlBlockPreview {
  sanitizedHtml: string
  srcDoc: string
}

interface HtmlBlockPreviewOptions {
  scripts?: unknown
}

interface CssSanitization {
  css: string
}

interface SanitizedHtmlBlockMarkup {
  bodyHtml: string
  scriptHtml: string
  styleHtml: string
}

function stripCssRemoteLoads({ css }: CssSanitization): string {
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

  const sanitized = stripCssRemoteLoads({ css: style }).trim()
  if (sanitized.length > 0) {
    element.setAttribute('style', sanitized)
  } else {
    element.removeAttribute('style')
  }
}

function sanitizeStyleElement(element: Element): void {
  element.textContent = stripCssRemoteLoads({ css: element.textContent ?? '' })
}

function escapeScriptText(text: string): string {
  return text.replace(/<\/script/giu, '<\\/script')
}

function escapeScriptAttributeValue(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}

function normalizedScriptType(element: HTMLScriptElement): string {
  return (element.getAttribute('type') ?? '').trim().toLowerCase()
}

function safeScriptType(element: HTMLScriptElement): string | null {
  if (element.hasAttribute('src')) return null

  const type = normalizedScriptType(element)
  if (EXECUTABLE_SCRIPT_TYPES.has(type)) return ''
  if (DATA_SCRIPT_TYPES.has(type)) return type
  return null
}

function scriptElementHtml(element: HTMLScriptElement): string {
  const type = safeScriptType(element)
  if (type === null) return ''

  const typeAttribute = type ? ` type="${type}"` : ''
  const id = element.getAttribute('id')?.trim() ?? ''
  const idAttribute = id ? ` id="${escapeScriptAttributeValue(id)}"` : ''
  return `<script${typeAttribute}${idAttribute}>${escapeScriptText(element.textContent ?? '')}</script>`
}

function extractSandboxedScriptHtml(markup: string, scripts: HtmlBlockScripts): string {
  if (scripts !== HTML_BLOCK_SCRIPTS_SANDBOXED) return ''

  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  return Array.from(parsed.querySelectorAll('script'))
    .map(scriptElementHtml)
    .join('')
}

function extractStyleHtml(documentObject: Document): string {
  const styleElements = Array.from(documentObject.querySelectorAll('style'))

  return styleElements
    .map((styleElement) => {
      const styleHtml = styleElement.outerHTML
      styleElement.remove()
      return styleHtml
    })
    .join('')
}

function sanitizeAnchor(anchor: HTMLAnchorElement): void {
  if (!anchor.hasAttribute('href')) return

  anchor.setAttribute('target', '_blank')
  anchor.setAttribute('rel', 'noreferrer noopener')
}

function sanitizeParsedHtml(documentObject: Document): SanitizedHtmlBlockMarkup {
  documentObject.querySelectorAll('*').forEach((element) => {
    removeRemoteLoadingAttributes(element)
    sanitizeInlineStyle(element)
    if (element instanceof HTMLStyleElement) sanitizeStyleElement(element)
    if (element instanceof HTMLAnchorElement) sanitizeAnchor(element)
  })
  const styleHtml = extractStyleHtml(documentObject)
  return {
    bodyHtml: documentObject.body.innerHTML,
    scriptHtml: '',
    styleHtml,
  }
}

function htmlBlockCsp(scripts: HtmlBlockScripts): string {
  const scriptPolicy = scripts === HTML_BLOCK_SCRIPTS_SANDBOXED
    ? "script-src 'unsafe-inline'"
    : "script-src 'none'"
  return [HTML_BLOCK_BASE_CSP_DIRECTIVES[0], scriptPolicy, ...HTML_BLOCK_BASE_CSP_DIRECTIVES.slice(1)].join('; ')
}

function sanitizeHtmlBlockMarkupParts(markup: string, options: HtmlBlockPreviewOptions = {}): SanitizedHtmlBlockMarkup {
  const scripts = normalizeHtmlBlockScripts(options.scripts)
  const scriptHtml = extractSandboxedScriptHtml(markup, scripts)
  const sanitized = DOMPurify.sanitize(markup, HTML_BLOCK_SANITIZE_CONFIG)
  const parsed = new DOMParser().parseFromString(sanitized, 'text/html')
  return {
    ...sanitizeParsedHtml(parsed),
    scriptHtml,
  }
}

export function sanitizeHtmlBlockMarkup(markup: string, options: HtmlBlockPreviewOptions = {}): string {
  const sanitized = sanitizeHtmlBlockMarkupParts(markup, options)
  return `${sanitized.styleHtml}${sanitized.bodyHtml}${sanitized.scriptHtml}`
}

function htmlBlockIframeSrcDocFromSanitizedHtml({
  bodyHtml,
  scriptHtml,
  styleHtml,
}: SanitizedHtmlBlockMarkup, scripts: HtmlBlockScripts): string {
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${htmlBlockCsp(scripts)}">`,
    '<style>',
    ':root { color-scheme: light dark; }',
    'html, body { margin: 0; min-height: 100%; }',
    'body { box-sizing: border-box; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: CanvasText; background: Canvas; }',
    'a { color: LinkText; }',
    '* { box-sizing: border-box; max-width: 100%; }',
    '</style>',
    styleHtml,
    '</head>',
    '<body>',
    bodyHtml,
    scriptHtml,
    '</body>',
    '</html>',
  ].join('')
}

export function htmlBlockPreview(markup: string, options: HtmlBlockPreviewOptions = {}): HtmlBlockPreview {
  const scripts = normalizeHtmlBlockScripts(options.scripts)
  const sanitized = sanitizeHtmlBlockMarkupParts(markup, { scripts })
  const sanitizedHtml = `${sanitized.styleHtml}${sanitized.bodyHtml}${sanitized.scriptHtml}`
  return {
    sanitizedHtml,
    srcDoc: htmlBlockIframeSrcDocFromSanitizedHtml(sanitized, scripts),
  }
}

export function htmlBlockIframeSrcDoc(markup: string, options: HtmlBlockPreviewOptions = {}): string {
  return htmlBlockPreview(markup, options).srcDoc
}
