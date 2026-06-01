function fallbackStreamEventId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function createScopedStreamEventName(baseName: string): string {
  return `${baseName}-${globalThis.crypto?.randomUUID?.() ?? fallbackStreamEventId()}`
}
