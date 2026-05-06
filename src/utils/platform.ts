import { isTauri } from '../mock-tauri'

function getUserAgent(): string {
  if (typeof navigator === 'undefined') return ''
  return navigator.userAgent
}

export function isLinux(): boolean {
  const userAgent = getUserAgent()
  return userAgent.includes('Linux') && !userAgent.includes('Android')
}

export function isMac(): boolean {
  const userAgent = getUserAgent()
  return userAgent.includes('Mac OS X') || userAgent.includes('Macintosh')
}

export function isWindows(): boolean {
  return getUserAgent().includes('Windows')
}

export function shouldUseLinuxWindowChrome(): boolean {
  return isTauri() && isLinux()
}
