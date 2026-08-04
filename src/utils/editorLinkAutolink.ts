const FILE_LIKE_EXTENSION_PATTERN =
  /\.(?:md|markdown|txt|ya?ml|json|toml|csv|tsv|pdf|png|jpe?g|gif|svg|webp|avif|mp3|wav|ogg|mp4|mov|zip|tar|gz|tsx?|jsx?|cjs|mjs|rs|py|sh|css|html?)$/i

const EXPLICIT_PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i
const MAYBE_PROTOCOL_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const LOCAL_PATH_PREFIX_PATTERN = /^(?:\.{1,2}\/|~\/|\/)/
const WINDOWS_PATH_SEPARATOR = '\\'
const WWW_PREFIX = 'www.'

export type LinkValue = {
  raw: string
}

export type LinkMarkCandidate = {
  href: LinkValue
  text: LinkValue
}

function withRaw(raw: string): LinkValue {
  return { raw }
}

function stripUrlDecorators(value: LinkValue) {
  return withRaw(value.raw.split(/[?#]/, 1)[0] ?? value.raw)
}

function stripProtocol(value: LinkValue) {
  return withRaw(value.raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''))
}

function isExplicitProtocolUrl(value: LinkValue) {
  return EXPLICIT_PROTOCOL_PATTERN.test(value.raw)
}

function isMaybeProtocolUrl(value: LinkValue) {
  return MAYBE_PROTOCOL_PATTERN.test(value.raw)
}

function hasWindowsPathSeparator(value: LinkValue) {
  return value.raw.includes(WINDOWS_PATH_SEPARATOR)
}

function hasPathSeparator(value: LinkValue) {
  return value.raw.includes('/')
}

function startsWithWebHostPrefix(value: LinkValue) {
  return value.raw.startsWith(WWW_PREFIX)
}

function firstPathSegment(value: LinkValue) {
  return value.raw.split('/', 1)[0] ?? value.raw
}

function isDomainLikePath(value: LinkValue) {
  return firstPathSegment(value).includes('.')
}

function isExplicitWebUrl(value: LinkValue) {
  return isExplicitProtocolUrl(value) || startsWithWebHostPrefix(value)
}

function isSingleSegmentValue(value: LinkValue) {
  return !hasPathSeparator(value)
}

function isLocalPathPrefix(value: LinkValue) {
  return LOCAL_PATH_PREFIX_PATTERN.test(value.raw)
}

function isPathLikeFileReference(value: LinkValue) {
  return hasPathSeparator(value) && !isDomainLikePath(value)
}

function hasBareProtocolPrefix(value: LinkValue) {
  return isMaybeProtocolUrl(value) && !value.raw.includes('@')
}

function hostnameHasTld(hostname: string) {
  return hostname.includes('.')
}

function isIpv4Host(hostname: string) {
  const parts = hostname.split('.')
  return parts.length === 4 && parts.every((part) => {
    if (part.length === 0 || part.length > 3) return false
    if ([...part].some((char) => char < '0' || char > '9')) return false
    return Number(part) <= 255
  })
}

function normalizeInput(value: LinkValue) {
  return stripUrlDecorators(withRaw(value.raw.trim()))
}

export function looksLikeLocalFileReference(value: LinkValue) {
  const normalized = normalizeInput(value)
  if (!normalized.raw) return false

  if (isLocalPathPrefix(normalized) || hasWindowsPathSeparator(normalized)) {
    return true
  }

  if (!FILE_LIKE_EXTENSION_PATTERN.test(normalized.raw)) {
    return false
  }

  if (isExplicitWebUrl(normalized)) {
    return false
  }

  if (isSingleSegmentValue(normalized)) {
    return true
  }

  return isPathLikeFileReference(normalized)
}

export function shouldAutoLinkTolariaHref(url: LinkValue) {
  if (looksLikeLocalFileReference(url)) {
    return false
  }

  if (isExplicitProtocolUrl(url) || hasBareProtocolPrefix(url)) {
    return true
  }

  const hostname = hostnameFromUrlLikeValue(url)
  if (isIpv4Host(hostname)) {
    return false
  }

  return hostnameHasTld(hostname)
}

export function shouldStripAutoLinkedLocalFileMark(mark: LinkMarkCandidate) {
  const normalizedText = normalizeInput(mark.text)
  if (!looksLikeLocalFileReference(normalizedText)) {
    return false
  }

  const normalizedHref = stripUrlDecorators(
    stripProtocol(normalizeInput(mark.href)),
  )
  return normalizedHref.raw === normalizedText.raw
}

function hostnameFromUrlLikeValue(value: LinkValue) {
  const withoutUserinfo = value.raw.includes('@') ? value.raw.split('@').pop() ?? value.raw : value.raw
  return withoutUserinfo.split(/[/?#:]/, 1)[0] ?? withoutUserinfo
}
