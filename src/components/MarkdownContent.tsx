import { memo, useMemo } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { preprocessWikilinks, WIKILINK_SCHEME } from '../utils/chatWikilinks'
import { supportsModernRegexFeatures } from '../utils/regexCapabilities'

const MODERN_REGEX_AVAILABLE = supportsModernRegexFeatures()
const REMARK_PLUGINS = MODERN_REGEX_AVAILABLE ? [remarkGfm] : []
const REHYPE_PLUGINS = MODERN_REGEX_AVAILABLE ? [rehypeHighlight] : []

function wikilinkUrlTransform(url: string): string {
  if (url.startsWith(WIKILINK_SCHEME)) return url
  return defaultUrlTransform(url)
}

interface MarkdownContentProps {
  content: string
  onWikilinkClick?: (target: string) => void
}

export const MarkdownContent = memo(function MarkdownContent({ content, onWikilinkClick }: MarkdownContentProps) {
  const processedContent = useMemo(
    () => onWikilinkClick ? preprocessWikilinks(content) : content,
    [content, onWikilinkClick],
  )

  const components = useMemo(() => {
    if (!onWikilinkClick) return undefined
    return {
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
        if (href?.startsWith(WIKILINK_SCHEME)) {
          const target = decodeURIComponent(href.slice(WIKILINK_SCHEME.length))
          return (
            <a
              ref={(node) => {
                node?.setAttribute('role', 'link')
                node?.setAttribute('tabindex', '0')
              }}
              href={href}
              className="chat-wikilink border-0 bg-transparent p-0"
              data-wikilink-target={target}
              onClick={(event) => {
                event.preventDefault()
                onWikilinkClick(target)
              }}
            >
              {children}
            </a>
          )
        }
        return <a href={href}>{children}</a>
      },
    }
  }, [onWikilinkClick])

  return (
    <div className="ai-markdown min-w-0 max-w-full overflow-hidden">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
        urlTransform={onWikilinkClick ? wikilinkUrlTransform : undefined}
      >
        {processedContent}
      </Markdown>
    </div>
  )
})
