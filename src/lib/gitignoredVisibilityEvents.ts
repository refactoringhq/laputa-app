import type { VaultEntry } from '../types'

export const TOGGLE_GITIGNORED_VISIBILITY_EVENT = 'tolaria:toggle-gitignored-visibility'
export const GITIGNORED_VISIBILITY_CHANGED_EVENT = 'tolaria:gitignored-visibility-changed'
export const GITIGNORED_VISIBILITY_APPLIED_EVENT = 'tolaria:gitignored-visibility-applied'

interface GitignoredVisibilityChangedDetail {
  hide: boolean
}

interface GitignoredVisibilityAppliedDetail extends GitignoredVisibilityChangedDetail {
  visiblePaths: string[]
}

export type GitignoredVisibilityChangedEvent = CustomEvent<GitignoredVisibilityChangedDetail>
export type GitignoredVisibilityAppliedEvent = CustomEvent<GitignoredVisibilityAppliedDetail>

function dispatchBrowserEvent<T>(name: string, detail: T): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function requestGitignoredVisibilityToggle(): void {
  dispatchBrowserEvent(TOGGLE_GITIGNORED_VISIBILITY_EVENT, {})
}

export function notifyGitignoredVisibilityChanged(hide: boolean): void {
  dispatchBrowserEvent(GITIGNORED_VISIBILITY_CHANGED_EVENT, { hide })
}

export function notifyGitignoredVisibilityApplied(hide: boolean, entries: VaultEntry[]): void {
  dispatchBrowserEvent(GITIGNORED_VISIBILITY_APPLIED_EVENT, {
    hide,
    visiblePaths: entries.map((entry) => entry.path),
  })
}
