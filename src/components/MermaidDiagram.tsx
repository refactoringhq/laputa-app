import { ArrowsOut as Maximize2, PencilSimpleLine } from '@phosphor-icons/react'
import { useEffect, useId, useMemo, useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { APP_COMMAND_EVENT_NAME, APP_COMMAND_IDS } from '../hooks/appCommandDispatcher'
import { translate } from '../lib/i18n'
import { trackEvent } from '../lib/telemetry'
import { SafeSvgDiv } from './SafeMarkup'

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

const MERMAID_RENDER_HOST_STYLE = [
  'position:absolute',
  'left:-10000px',
  'top:-10000px',
  'width:960px',
  'min-height:1px',
  'overflow:hidden',
].join(';')
const OPEN_RAW_EDITOR_LABEL = translate('en', 'editor.toolbar.rawOpen')

function renderIdFromReactId(reactId: string): string {
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, '')
  return `tolaria-mermaid-${safeId || 'diagram'}`
}

function initializeMermaid(mermaid: MermaidApi) {
  if (initialized) return

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: 'default',
    suppressErrorRendering: true,
    themeVariables: {
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    },
  })
  initialized = true
}

function appendMermaidRenderHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.setAttribute('data-tolaria-mermaid-render-host', '')
  host.style.cssText = MERMAID_RENDER_HOST_STYLE
  document.body.appendChild(host)
  return host
}

function removeMermaidRenderArtifacts(renderId: string, host: HTMLElement): void {
  host.remove()
  document.getElementById(renderId)?.remove()
  document.getElementById(`d${renderId}`)?.remove()
  document.getElementById(`i${renderId}`)?.remove()
}

function hasSvgParseError(document: Document): boolean {
  return document.getElementsByTagName('parsererror').length > 0
}

function centerMermaidNodeLabels(svg: string): string {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (hasSvgParseError(parsed)) return svg

  parsed.querySelectorAll('.node .label text, .node text').forEach((label) => {
    label.setAttribute('text-anchor', 'middle')
    label.querySelectorAll('tspan').forEach((row) => {
      row.setAttribute('text-anchor', 'middle')
    })
  })

  return new XMLSerializer().serializeToString(parsed.documentElement)
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
    const renderHost = appendMermaidRenderHost()
    try {
      const result = await mermaid.render(renderId, diagram, renderHost)
      return centerMermaidNodeLabels(result.svg)
    } finally {
      removeMermaidRenderArtifacts(renderId, renderHost)
    }
  }
  const nextRender = renderQueue.then(render, render)
  renderQueue = nextRender.then(() => undefined, () => undefined)
  return nextRender
}

function MermaidSvgViewport({ ariaLabel, className, svg, testId }: MermaidSvgViewportProps) {
  return (
    <SafeSvgDiv
      aria-label={ariaLabel}
      className={className}
      contentEditable={false}
      data-testid={testId}
      draggable={false}
      onClick={stopMermaidViewportEvent}
      onDoubleClick={stopMermaidViewportEvent}
      onMouseDown={stopMermaidViewportEvent}
      onMouseUp={stopMermaidViewportEvent}
      onPointerDown={stopMermaidViewportEvent}
      onPointerUp={stopMermaidViewportEvent}
      role="img"
      svg={svg}
      suppressContentEditableWarning
      tabIndex={0}
    />
  )
}

function stopMermaidViewportEvent(event: SyntheticEvent): void {
  event.stopPropagation()
}

function openRawEditorForMermaidSource(event: SyntheticEvent): void {
  event.preventDefault()
  event.stopPropagation()
  trackEvent('editor_mermaid_raw_edit_requested')
  window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT_NAME, {
    detail: APP_COMMAND_IDS.editToggleRawEditor,
  }))
}

function MermaidRawEditorButton() {
  return (
    <Button
      aria-label={OPEN_RAW_EDITOR_LABEL}
      className="mermaid-diagram__edit-button"
      contentEditable={false}
      onClick={openRawEditorForMermaidSource}
      onMouseDown={stopMermaidViewportEvent}
      size="icon-sm"
      title={OPEN_RAW_EDITOR_LABEL}
      type="button"
      variant="outline"
    >
      <PencilSimpleLine aria-hidden="true" />
    </Button>
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

function MermaidSourceFallback({ source }: { source: string }) {
  return <pre aria-label="Mermaid source"><code>{source}</code></pre>
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
        <MermaidRawEditorButton />
        <figcaption>Mermaid diagram unavailable</figcaption>
        <MermaidSourceFallback source={source} />
      </figure>
    )
  }

  return (
    <figure className="mermaid-diagram" data-testid="mermaid-diagram">
      <MermaidRawEditorButton />
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
