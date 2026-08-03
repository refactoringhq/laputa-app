export type TauriUnlisten = () => void | Promise<void>

export function cleanupTauriEventListener(unlisten: TauriUnlisten | null | undefined): void {
  if (!unlisten) return

  void Promise.resolve()
    .then(unlisten)
    .catch(() => { /* Listener cleanup is best-effort during teardown. */ })
}

export function cleanupTauriEventListeners(
  unlisteners: Iterable<TauriUnlisten | null | undefined>,
): void {
  for (const unlisten of unlisteners) cleanupTauriEventListener(unlisten)
}
