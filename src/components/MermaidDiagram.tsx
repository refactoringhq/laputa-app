import { useEffect, useId, useMemo, useState } from 'react'

type MermaidApi = typeof import('mermaid')['default']

interface MermaidDiagramProps {
  diagram: string
  source: string
}

interface RenderState {
  diagram: string
  svg: string
  error: boolean
}

let initialized = false
let renderQueue = Promise.resolve()

function renderIdFromReactId(reactId: string): string {
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, '')
  return `tolaria-mermaid-${safeId || 'diagram'}`
}

function initializeMermaid(mermaid: MermaidApi) {
  if (initialized) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      background: '#ffffff',
      primaryColor: '#f8fafc',
      primaryTextColor: '#111827',
      primaryBorderColor: '#94a3b8',
      lineColor: '#64748b',
      secondaryColor: '#f1f5f9',
      tertiaryColor: '#e0f2fe',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
  })
  initialized = true
}

async function renderMermaidDiagram({
  diagram,
  renderId,
}: {
  diagram: string
  renderId: string
}): Promise<string> {
  const render = async () => {
    const mermaid = (await import('mermaid')).default
    initializeMermaid(mermaid)
    const result = await mermaid.render(renderId, diagram)
    return result.svg
  }
  const nextRender = renderQueue.then(render, render)
  renderQueue = nextRender.then(() => undefined, () => undefined)
  return nextRender
}

export function MermaidDiagram({ diagram, source }: MermaidDiagramProps) {
  const reactId = useId()
  const renderId = useMemo(() => renderIdFromReactId(reactId), [reactId])
  const [state, setState] = useState<RenderState>({ diagram: '', svg: '', error: false })

  useEffect(() => {
    let active = true
    if (!diagram.trim()) return () => { active = false }

    renderMermaidDiagram({ diagram, renderId })
      .then((svg) => {
        if (active) setState({ diagram, svg, error: false })
      })
      .catch(() => {
        if (active) setState({ diagram, svg: '', error: true })
      })

    return () => { active = false }
  }, [diagram, renderId])

  const currentState = state.diagram === diagram ? state : { diagram, svg: '', error: false }
  if (!diagram.trim() || currentState.error) {
    return (
      <figure className="mermaid-diagram mermaid-diagram--error" data-testid="mermaid-diagram-error">
        <figcaption>Mermaid diagram unavailable</figcaption>
        <pre aria-label="Mermaid source"><code>{source}</code></pre>
      </figure>
    )
  }

  return (
    <figure className="mermaid-diagram" data-testid="mermaid-diagram">
      <div
        aria-label="Mermaid diagram"
        className="mermaid-diagram__viewport"
        data-testid="mermaid-diagram-viewport"
        role="img"
        tabIndex={0}
        dangerouslySetInnerHTML={{ __html: currentState.svg }}
      />
    </figure>
  )
}
