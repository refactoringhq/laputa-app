import DOMPurify from 'dompurify'
import {
  HTML_BLOCK_SCRIPTS_SANDBOXED as SCRIPTS_SANDBOXED,
  normalizeHtmlBlockScripts as normalizeBlockScripts,
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
const BASE_CSP_DIRECTIVES = [
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
const ALLOWED_URI_PATTERN = /^(?:(?:https?|mailto|tel|tolaria):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/iu
const EXECUTABLE_SCRIPT_TYPES = new Set(['', 'application/javascript', 'text/javascript'])
const DATA_SCRIPT_TYPES = new Set(['application/json', 'application/ld+json', 'text/plain'])

const SANITIZE_CONFIG = {
  ALLOWED_URI_REGEXP: ALLOWED_URI_PATTERN,
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['base', 'embed', 'iframe', 'link', 'meta', 'object', 'script'],
  WHOLE_DOCUMENT: true,
}

interface HtmlBlockPreview {
  sanitizedHtml: string
  src?: string
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

function scriptElementAsHtml(element: HTMLScriptElement): string {
  const type = safeScriptType(element)
  if (type === null) return ''

  const typeAttribute = type ? ` type="${type}"` : ''
  const id = element.getAttribute('id')?.trim() ?? ''
  const idAttribute = id ? ` id="${escapeScriptAttributeValue(id)}"` : ''
  return `<script${typeAttribute}${idAttribute}>${escapeScriptText(element.textContent ?? '')}</script>`
}

function extractSandboxedScriptAsHtml(markup: string, scripts: HtmlBlockScripts): string {
  if (scripts !== SCRIPTS_SANDBOXED) return ''

  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  let scriptHtml = ''
  for (const element of parsed.querySelectorAll('script')) {
    scriptHtml += scriptElementAsHtml(element)
  }
  return scriptHtml
}

function extractStyleAsHtml(documentObject: Document): string {
  const styleElements = Array.from(documentObject.querySelectorAll('style'))
  let styleHtml = ''
  for (const styleElement of styleElements) {
    styleHtml += styleElement.outerHTML
    styleElement.remove()
  }
  return styleHtml
}

function sanitizeAnchor(anchor: HTMLAnchorElement): void {
  if (!anchor.hasAttribute('href')) return

  anchor.setAttribute('target', '_blank')
  anchor.setAttribute('rel', 'noreferrer noopener')
}

function sanitizeParsedMarkup(documentObject: Document): SanitizedHtmlBlockMarkup {
  documentObject.querySelectorAll('*').forEach((element) => {
    removeRemoteLoadingAttributes(element)
    sanitizeInlineStyle(element)
    if (element instanceof HTMLStyleElement) sanitizeStyleElement(element)
    if (element instanceof HTMLAnchorElement) sanitizeAnchor(element)
  })
  const styleHtml = extractStyleAsHtml(documentObject)
  return {
    bodyHtml: documentObject.body.innerHTML,
    scriptHtml: '',
    styleHtml,
  }
}

function blockCsp(scripts: HtmlBlockScripts): string {
  const scriptPolicy = scripts === SCRIPTS_SANDBOXED
    ? "script-src 'unsafe-inline'"
    : "script-src 'none'"
  return [BASE_CSP_DIRECTIVES.at(0) ?? "default-src 'none'", scriptPolicy, ...BASE_CSP_DIRECTIVES.slice(1)].join('; ')
}

function sanitizeMarkupParts(markup: string, options: HtmlBlockPreviewOptions = {}): SanitizedHtmlBlockMarkup {
  const scripts = normalizeBlockScripts(options.scripts)
  const scriptHtml = extractSandboxedScriptAsHtml(markup, scripts)
  const sanitized = DOMPurify.sanitize(markup, SANITIZE_CONFIG)
  const parsed = new DOMParser().parseFromString(sanitized, 'text/html')
  return {
    ...sanitizeParsedMarkup(parsed),
    scriptHtml,
  }
}

export function sanitizeHtmlBlockMarkup(markup: string, options: HtmlBlockPreviewOptions = {}): string {
  const sanitized = sanitizeMarkupParts(markup, options)
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
    `<meta http-equiv="Content-Security-Policy" content="${blockCsp(scripts)}">`,
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

function sandboxedScriptDataUrl(srcDoc: string, scripts: HtmlBlockScripts): string | undefined {
  if (scripts !== SCRIPTS_SANDBOXED) return undefined
  return `data:text/html;charset=utf-8,${encodeURIComponent(srcDoc)}`
}

export function htmlBlockPreview(markup: string, options: HtmlBlockPreviewOptions = {}): HtmlBlockPreview {
  const scripts = normalizeBlockScripts(options.scripts)
  const sanitized = sanitizeMarkupParts(markup, { scripts })
  const sanitizedHtml = `${sanitized.styleHtml}${sanitized.bodyHtml}${sanitized.scriptHtml}`
  const srcDoc = htmlBlockIframeSrcDocFromSanitizedHtml(sanitized, scripts)
  return {
    sanitizedHtml,
    src: sandboxedScriptDataUrl(srcDoc, scripts),
    srcDoc,
  }
}

export function htmlBlockIframeSrcDoc(markup: string, options: HtmlBlockPreviewOptions = {}): string {
  return htmlBlockPreview(markup, options).srcDoc
}

function escapeScriptAttributeValue(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}
