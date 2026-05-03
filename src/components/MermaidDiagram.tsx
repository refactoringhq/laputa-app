import { useEffect, useId, useMemo, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { RUNTIME_STYLE_NONCE } from '@/lib/runtimeStyleNonce'

type MermaidApi = typeof import('mermaid')['default']

interface MermaidDiagramProps {
  diagram: string
  source: string
}

interface MermaidSvgViewportProps {
  ariaLabel: string
  className: string
  svg: string
  testId: string
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
    theme: 'default',
    themeVariables: {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
  })
  initialized = true
}

function withRuntimeStyleNonce(svg: string): string {
  if (!svg.includes('<style')) return svg
  if (typeof document === 'undefined') return svg

  const container = document.createElement('div')
  container.innerHTML = svg
  container.querySelectorAll('style').forEach((style) => {
    style.setAttribute('nonce', RUNTIME_STYLE_NONCE)
  })
  return container.innerHTML
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
    return withRuntimeStyleNonce(result.svg)
  }
  const nextRender = renderQueue.then(render, render)
  renderQueue = nextRender.then(() => undefined, () => undefined)
  return nextRender
}

function MermaidSvgViewport({ ariaLabel, className, svg, testId }: MermaidSvgViewportProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={className}
      data-testid={testId}
      role="img"
      tabIndex={0}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

function MermaidLightbox({ svg }: { svg: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          aria-label="Open Mermaid diagram"
          className="mermaid-diagram__expand-button"
          size="icon-sm"
          title="Open diagram"
          type="button"
          variant="outline"
        >
          <Maximize2 aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="mermaid-diagram__dialog" showCloseButton>
        <DialogTitle className="sr-only">Mermaid diagram</DialogTitle>
        <DialogDescription className="sr-only">
          Expanded view of the rendered Mermaid diagram.
        </DialogDescription>
        <MermaidSvgViewport
          ariaLabel="Expanded Mermaid diagram"
          className="mermaid-diagram__dialog-viewport"
          svg={svg}
          testId="mermaid-diagram-dialog-viewport"
        />
      </DialogContent>
    </Dialog>
  )
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
      <MermaidLightbox svg={currentState.svg} />
      <MermaidSvgViewport
        ariaLabel="Mermaid diagram"
        className="mermaid-diagram__viewport"
        svg={currentState.svg}
        testId="mermaid-diagram-viewport"
      />
    </figure>
  )
}
