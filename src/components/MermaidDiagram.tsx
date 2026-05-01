import { memo, useEffect, useId, useState } from 'react'

type Status = 'idle' | 'ready' | 'error'

interface MermaidDiagramProps {
  source: string
}

async function renderMermaid(id: string, source: string): Promise<string> {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
  const { svg } = await mermaid.render(id, source)
  return svg
}

export const MermaidDiagram = memo(function MermaidDiagram({ source }: MermaidDiagramProps) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '-')
  const renderId = `mermaid-${baseId}`
  const [status, setStatus] = useState<Status>('idle')
  const [svg, setSvg] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const result = await renderMermaid(renderId, source)
        if (cancelled) return
        setSvg(result)
        setStatus('ready')
      } catch (error: unknown) {
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : 'Failed to render diagram')
        setStatus('error')
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [renderId, source])

  if (status === 'error') {
    return (
      <div className="mermaid-diagram mermaid-diagram--error" role="alert">
        <p>Failed to render Mermaid diagram</p>
        <pre>{errorMessage}</pre>
        <pre>{source}</pre>
      </div>
    )
  }

  return (
    <div
      className="mermaid-diagram"
      data-testid="mermaid-diagram"
      data-status={status}
      aria-busy={status === 'idle'}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
})
