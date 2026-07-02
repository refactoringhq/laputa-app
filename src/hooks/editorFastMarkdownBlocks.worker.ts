import { tryParseFastMarkdownBlocks } from './editorFastMarkdownBlocks'

self.onmessage = (event: MessageEvent<string>) => {
  self.postMessage(tryParseFastMarkdownBlocks(event.data))
}
