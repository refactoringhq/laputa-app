const WIKILINK_SCHEME = 'wikilink://'

export { WIKILINK_SCHEME }

function encodeTarget(target: string): string {
  return encodeURIComponent(target).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function escapeLinkText(text: string): string {
  return text.replace(/[[\]]/g, '\\$&')
}

function replaceWikilinksInText(text: string): string {
  return text.replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => {
    const pipeIdx = inner.indexOf('|')
    const target = pipeIdx !== -1 ? inner.slice(0, pipeIdx) : inner
    const display = pipeIdx !== -1 ? inner.slice(pipeIdx + 1) : inner
    return `[${escapeLinkText(display)}](${WIKILINK_SCHEME}${encodeTarget(target)})`
  })
}

/** Convert [[Target]] to markdown links, but skip code blocks and inline code. */
export function preprocessWikilinks(md: string): string {
  const segments: string[] = []
  const codeRegex = /(```[\s\S]*?```|`[^`\n]+`)/g
  let lastIndex = 0
  let match = codeRegex.exec(md)
  while (match !== null) {
    segments.push(replaceWikilinksInText(md.slice(lastIndex, match.index)))
    segments.push(match[0])
    lastIndex = match.index + match[0].length
    match = codeRegex.exec(md)
  }
  segments.push(replaceWikilinksInText(md.slice(lastIndex)))
  return segments.join('')
}
