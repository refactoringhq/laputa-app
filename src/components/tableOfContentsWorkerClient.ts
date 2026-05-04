import { buildTableOfContentsFromMarkdownOnly, type TocItem } from './tableOfContentsModel'

export const TOC_BUILD_DEBOUNCE_MS = 180

interface WorkerRequest {
  entryTitle: string
  markdown: string
  requestId: number
}

interface WorkerResponse {
  requestId: number
  toc: TocItem
}

interface PendingRequest {
  reject: (reason?: unknown) => void
  resolve: (toc: TocItem) => void
}

let nextRequestId = 1
let tocWorker: Worker | null = null
const pendingRequests = new Map<number, PendingRequest>()

function rejectPendingRequests(reason: unknown) {
  pendingRequests.forEach(({ reject }) => reject(reason))
  pendingRequests.clear()
}

function buildTocWithoutWorker(entryTitle: string, markdown: string): Promise<TocItem> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(buildTableOfContentsFromMarkdownOnly(entryTitle, markdown))
    }, 0)
  })
}

function handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
  const pending = pendingRequests.get(event.data.requestId)
  if (!pending) return

  pendingRequests.delete(event.data.requestId)
  pending.resolve(event.data.toc)
}

function handleWorkerError(event: ErrorEvent) {
  rejectPendingRequests(event.error ?? event.message)
  tocWorker?.terminate()
  tocWorker = null
}

function activeTocWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (tocWorker) return tocWorker

  tocWorker = new Worker(new URL('./tableOfContents.worker.ts', import.meta.url), { type: 'module' })
  tocWorker.onmessage = handleWorkerMessage
  tocWorker.onerror = handleWorkerError
  return tocWorker
}

export function buildTableOfContentsInWorker(entryTitle: string, markdown: string): Promise<TocItem> {
  const worker = activeTocWorker()
  if (!worker) return buildTocWithoutWorker(entryTitle, markdown)

  return new Promise((resolve, reject) => {
    const requestId = nextRequestId
    nextRequestId += 1
    pendingRequests.set(requestId, { resolve, reject })

    const request: WorkerRequest = { entryTitle, markdown, requestId }
    worker.postMessage(request)
  })
}
