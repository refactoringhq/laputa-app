/// <reference lib="webworker" />

import { buildTableOfContentsFromMarkdownOnly, type TocItem } from './tableOfContentsModel'

interface TocWorkerRequest {
  entryTitle: string
  markdown: string
  requestId: number
}

interface TocWorkerResponse {
  requestId: number
  toc: TocItem
}

const ctx = self as DedicatedWorkerGlobalScope

ctx.onmessage = (event: MessageEvent<TocWorkerRequest>) => {
  const { entryTitle, markdown, requestId } = event.data
  const response: TocWorkerResponse = {
    requestId,
    toc: buildTableOfContentsFromMarkdownOnly(entryTitle, markdown),
  }
  ctx.postMessage(response)
}

export {}
