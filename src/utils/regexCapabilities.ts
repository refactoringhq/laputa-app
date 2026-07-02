export function supportsModernRegexFeatures(): boolean {
  try {
    new RegExp('', 'd')
    new RegExp('[[]]', 'v')
    new RegExp('(?<=a)b')
    new RegExp('(?<!a)b')
    new RegExp('(?<label>a)')
    return true
  } catch {
    return false
  }
}

function getUserAgent(): string {
  if (typeof navigator === 'undefined') return ''
  return navigator.userAgent
}

function isWebKitRuntime(): boolean {
  const userAgent = getUserAgent()
  return userAgent.includes('AppleWebKit')
    && !userAgent.includes('Chrome/')
    && !userAgent.includes('Chromium/')
    && !userAgent.includes('Edg/')
}

export function supportsShikiRegexFeatures(): boolean {
  return supportsModernRegexFeatures() && !isWebKitRuntime()
}
