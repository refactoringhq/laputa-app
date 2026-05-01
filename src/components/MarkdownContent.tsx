import { memo, useMemo, useCallback, type MouseEvent, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { preprocessWikilinks, WIKILINK_SCHEME } from '../utils/chatWikilinks'
import { MermaidDiagram } from './MermaidDiagram'

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeHighlight]
const MERMAID_LANGUAGE_CLASS = 'language-mermaid'

function wikilinkUrlTransform(url: string): string {
  if (url.startsWith(WIKILINK_SCHEME)) return url
  return defaultUrlTransform(url)
}

function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractText).join('')
  return ''
}

interface CodeProps {
  className?: string
  children?: ReactNode
}

function CodeRenderer({ className, children, ...rest }: CodeProps) {
  if (className?.split(/\s+/).includes(MERMAID_LANGUAGE_CLASS)) {
    return <MermaidDiagram source={extractText(children).replace(/\n$/, '')} />
  }
  return <code className={className} {...rest}>{children}</code>
}

interface WikilinkAnchorProps {
  href?: string
  children?: ReactNode
}

function WikilinkAnchor({ href, children }: WikilinkAnchorProps) {
  if (href?.startsWith(WIKILINK_SCHEME)) {
    const target = decodeURIComponent(href.slice(WIKILINK_SCHEME.length))
    return (
      <span className="chat-wikilink" data-wikilink-target={target} role="link" tabIndex={0}>
        {children}
      </span>
    )
  }
  return <a href={href}>{children}</a>
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

  const handleClick = useCallback((e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-wikilink-target]')
    if (el) {
      e.preventDefault()
      onWikilinkClick?.(el.dataset.wikilinkTarget!)
    }
  }, [onWikilinkClick])

  const components = useMemo(() => {
    const base = { code: CodeRenderer }
    if (!onWikilinkClick) return base
    return { ...base, a: WikilinkAnchor }
  }, [onWikilinkClick])

  return (
    <div className="ai-markdown" onClick={onWikilinkClick ? handleClick : undefined} role="presentation">
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
