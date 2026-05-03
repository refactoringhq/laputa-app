import type { MutableRefObject } from 'react'

export interface SwapToken {
  seq: number
  path: string
  content: string
}

interface SwapTab {
  entry: { path: string }
  content: string
}

export function createSwapToken(
  swapSeqRef: MutableRefObject<number>,
  path: string,
  content: string,
): SwapToken {
  const seq = swapSeqRef.current + 1
  swapSeqRef.current = seq
  return { seq, path, content }
}

export function invalidatePendingSwap(options: {
  pendingSwapRef: MutableRefObject<(() => void) | null>
  swapSeqRef: MutableRefObject<number>
}): void {
  options.swapSeqRef.current += 1
  options.pendingSwapRef.current = null
}

function activeTabMatchesSwapToken<Tab extends SwapTab>(options: {
  tabsRef: MutableRefObject<Tab[]>
  token: SwapToken
}): boolean {
  const { tabsRef, token } = options
  const activeTab = tabsRef.current.find(tab => tab.entry.path === token.path)
  return activeTab?.content === token.content
}

function isCurrentSwapToken<Tab extends SwapTab>(options: {
  prevActivePathRef: MutableRefObject<string | null>
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  token: SwapToken
}): boolean {
  const {
    prevActivePathRef,
    swapSeqRef,
    tabsRef,
    token,
  } = options

  return swapSeqRef.current === token.seq
    && prevActivePathRef.current === token.path
    && activeTabMatchesSwapToken({ tabsRef, token })
}

export function shouldAbortSwap<Tab extends SwapTab>(options: {
  prevActivePathRef: MutableRefObject<string | null>
  suppressChangeRef: MutableRefObject<boolean>
  swapSeqRef: MutableRefObject<number>
  tabsRef: MutableRefObject<Tab[]>
  token: SwapToken
}): boolean {
  const {
    prevActivePathRef,
    suppressChangeRef,
    swapSeqRef,
    tabsRef,
    token,
  } = options

  if (isCurrentSwapToken({ prevActivePathRef, swapSeqRef, tabsRef, token })) return false
  if (swapSeqRef.current === token.seq) suppressChangeRef.current = false
  return true
}
