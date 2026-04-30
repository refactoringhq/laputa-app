export interface GraphTheme {
  background: string
  nodeDefault: string
  nodeArchived: string
  nodeFocus: string
  nodeStroke: string
  nodeSelected: string
  link: string
  linkHighlight: string
  label: string
}

const TOKENS: Record<keyof GraphTheme, string> = {
  background: '--surface-card',
  nodeDefault: '--text-primary',
  nodeArchived: '--text-muted',
  nodeFocus: '--accent-blue',
  nodeStroke: '--surface-card',
  nodeSelected: '--text-primary',
  link: '--border-default',
  linkHighlight: '--accent-blue',
  label: '--text-secondary',
}

function readToken(token: string): string {
  if (typeof window === 'undefined') return ''
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return value || ''
}

function readTheme(): GraphTheme {
  return {
    background: readToken(TOKENS.background) || '#ffffff',
    nodeDefault: readToken(TOKENS.nodeDefault) || '#37352f',
    nodeArchived: readToken(TOKENS.nodeArchived) || '#b4b4b4',
    nodeFocus: readToken(TOKENS.nodeFocus) || '#155dff',
    nodeStroke: readToken(TOKENS.nodeStroke) || '#ffffff',
    nodeSelected: readToken(TOKENS.nodeSelected) || '#37352f',
    link: readToken(TOKENS.link) || '#e9e9e7',
    linkHighlight: readToken(TOKENS.linkHighlight) || '#155dff',
    label: readToken(TOKENS.label) || '#787774',
  }
}

export function useGraphTheme(): GraphTheme {
  return readTheme()
}
